import "dotenv/config";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openAndMatch, usdcBalance, operatorAddress, readMarket, resolveMarket, payUsdc, type Side, type Outcome } from "./arc.js";
import { resolveAsset, pythPrice, fmtPrice, ASSETS, ASSET_LIST, type AssetDef } from "./markets.js";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("BOT_TOKEN missing");
const FE_URL = process.env.FRONTEND_URL ?? "https://fud-arc-hackaton.vercel.app";

// In-memory metadata for markets this bot opened (served to the FE). Lost on
// restart by design — the FE also carries a baked seed for the curated markets.
interface MetaEntry {
  ticker: string;
  kind: "crypto" | "fx";
  side: "long" | "short";
  timeframe: string;
  pythId: string;
  anchor: number;
  caller?: string;
  call?: string;
  takes: { user: string; text: string; side: "long" | "short" }[];
}

// Full record stored per market: the served MetaEntry + internal fields the
// resolver needs (closesAt, resolved) and the caller's tg id for the payout.
interface MarketRec extends MetaEntry {
  closesAt: number;
  resolved: boolean;
  callerUid?: number;
}

// Persisted to a JSON file (Railway volume via DATA_DIR) so bot-opened markets +
// linked wallets survive restarts. Falls back to the cwd locally.
const DATA_DIR = process.env.DATA_DIR ?? ".";
const STORE = join(DATA_DIR, "store.json");

interface StoreShape {
  markets?: Record<string, MarketRec>;
  wallets?: Record<string, string>;
}

function loadStore(): { registry: Map<number, MarketRec>; userWallets: Map<number, string> } {
  try {
    if (!existsSync(STORE)) return { registry: new Map(), userWallets: new Map() };
    const raw = JSON.parse(readFileSync(STORE, "utf8")) as StoreShape;
    return {
      registry: new Map(Object.entries(raw.markets ?? {}).map(([k, v]) => [Number(k), v])),
      userWallets: new Map(Object.entries(raw.wallets ?? {}).map(([k, v]) => [Number(k), v])),
    };
  } catch (e) {
    console.error("[store] load failed:", (e as Error)?.message);
    return { registry: new Map(), userWallets: new Map() };
  }
}

function persist(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE, JSON.stringify({ markets: Object.fromEntries(registry), wallets: Object.fromEntries(userWallets) }), { mode: 0o600 });
  } catch (e) {
    console.error("[store] save failed:", (e as Error)?.message);
  }
}

const { registry, userWallets } = loadStore();

const U = (n: number) => BigInt(Math.round(n * 1e6)); // USDC 6-dp units
const DAY = 86400;
const TIMEFRAMES: Record<string, number> = { "15m": 900, "1h": 3600, "24h": 86400, "7d": 604800 };
const MAX_AMOUNT = 100;
const MIN_AMOUNT = 0.01;
const COOLDOWN_MS = 10_000;
const lastOpen = new Map<number, number>(); // tgUserId → ts

const bot = new Bot(TOKEN);

// ── Shared open path (used by quick commands + the guided flow) ──
async function doOpen(
  ctx: Context,
  uid: number,
  asset: AssetDef,
  side: "long" | "short",
  timeframe: string,
  amount: number,
  call?: string,
): Promise<void> {
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    await ctx.reply(`Amount must be between ${MIN_AMOUNT} and ${MAX_AMOUNT} USDC.`);
    return;
  }
  const now = Date.now();
  if (now - (lastOpen.get(uid) ?? 0) < COOLDOWN_MS) {
    await ctx.reply("Easy — one market every 10s.");
    return;
  }
  lastOpen.set(uid, now); // stamp before the await (closes the race); refunded on failure

  const takerAmt = Math.max(0.5, +(amount * 0.6).toFixed(2));
  const bal = await usdcBalance();
  if (bal < U(amount) + U(takerAmt)) {
    lastOpen.delete(uid);
    await ctx.reply(`Operator wallet low on USDC (${(Number(bal) / 1e6).toFixed(2)}). Try a smaller amount.`);
    return;
  }

  await ctx.reply(`⏳ Opening ${side.toUpperCase()} ${asset.ticker} for $${amount} on Arc…`);
  try {
    const anchor = await pythPrice(asset.pythId);
    const s: Side = side === "long" ? 0 : 1;
    const closesAt = Math.floor(now / 1000) + (TIMEFRAMES[timeframe] ?? DAY);
    const { marketId } = await openAndMatch({ closesAt, openerSide: s, openerAmount: U(amount), takerAmount: U(takerAmt) });
    const caller = ctx.from?.username ?? ctx.from?.first_name ?? "anon";
    registry.set(Number(marketId), {
      ticker: asset.ticker, kind: asset.kind, side, timeframe,
      pythId: asset.pythId, anchor: anchor ?? 0, caller, call: call?.slice(0, 140), takes: [],
      closesAt, resolved: false, callerUid: uid,
    });
    persist();
    await ctx.reply(
      `✅ Market #${marketId} opened on Arc\n${side === "long" ? "📈 LONG" : "📉 SHORT"} ${asset.ticker} · ${timeframe} · $${amount}` +
        `${call ? `\n“${call.slice(0, 140)}”` : ""}\nEntry: ${anchor ? "$" + fmtPrice(anchor) : "—"}\n\nLive → ${FE_URL}` +
        `${userWallets.has(uid) ? "" : "\n\n💸 /wallet 0x… to get paid your creator cut when this resolves."}`,
    );
  } catch (e) {
    lastOpen.delete(uid);
    console.error("[open] failed:", (e as Error)?.message);
    const short = (e as { shortMessage?: string })?.shortMessage ?? "on-chain error — try again in a moment";
    await ctx.reply(`⚠️ Couldn't open the market: ${short.slice(0, 120)}`);
  }
}

// ── Quick commands: /long BTC 1 · /short ETH 1 ──
async function quick(ctx: Context, side: "long" | "short"): Promise<void> {
  const uid = ctx.from?.id;
  if (!uid) return;
  const args = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  const asset = args[0] ? resolveAsset(args[0]) : null;
  if (!asset) {
    await ctx.reply(`Usage: /${side} <SYMBOL> [amount]\nSymbols: ${ASSET_LIST}\ne.g. /${side} BTC 1`);
    return;
  }
  await doOpen(ctx, uid, asset, side, "24h", args[1] ? Number(args[1]) : 1);
}
bot.command("long", (ctx) => quick(ctx, "long"));
bot.command("short", (ctx) => quick(ctx, "short"));

// ── Guided flow: /open → asset → side → amount → tagline ──
interface Draft {
  asset?: AssetDef;
  timeframe?: string;
  side?: "long" | "short";
  amount?: number;
  awaiting?: "amount" | "tagline";
}
const drafts = new Map<number, Draft>();

function assetKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  ASSETS.forEach((a, i) => {
    kb.text(a.ticker, `a:${a.key}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

bot.command(["open", "new", "call"], async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  drafts.set(uid, {});
  await ctx.reply("📣 Make a call — pick an asset:", { reply_markup: assetKeyboard() });
});

async function finalize(ctx: Context, uid: number, d: Draft, call?: string): Promise<void> {
  drafts.delete(uid);
  if (!d.asset || !d.timeframe || !d.side || !d.amount) {
    await ctx.reply("Incomplete — /open to start again.");
    return;
  }
  await doOpen(ctx, uid, d.asset, d.side, d.timeframe, d.amount, call);
}

bot.on("callback_query:data", async (ctx) => {
  const uid = ctx.from?.id;
  await ctx.answerCallbackQuery();
  if (!uid) return;
  const d = drafts.get(uid);
  const data = ctx.callbackQuery.data;
  if (!d) {
    await ctx.editMessageText("Session expired — /open to start again.").catch(() => {});
    return;
  }
  if (data.startsWith("a:")) {
    d.asset = resolveAsset(data.slice(2)) ?? undefined;
    d.awaiting = undefined;
    await ctx.editMessageText(`${d.asset?.ticker} — pick a timeframe:`, {
      reply_markup: new InlineKeyboard().text("15m", "tf:15m").text("1h", "tf:1h").text("24h", "tf:24h").text("7d", "tf:7d"),
    });
  } else if (data.startsWith("tf:")) {
    d.timeframe = data.slice(3);
    await ctx.editMessageText(`${d.asset?.ticker} · ${d.timeframe} — pick a side:`, {
      reply_markup: new InlineKeyboard().text("📈 Long", "s:long").text("📉 Short", "s:short"),
    });
  } else if (data.startsWith("s:")) {
    d.side = data.slice(2) as "long" | "short";
    await ctx.editMessageText(`${d.asset?.ticker} ${d.side.toUpperCase()} · ${d.timeframe} — amount:`, {
      reply_markup: new InlineKeyboard().text("$1", "amt:1").text("$5", "amt:5").text("$10", "amt:10").row().text("✏️ Custom", "amt:custom"),
    });
  } else if (data.startsWith("amt:")) {
    const v = data.slice(4);
    if (v === "custom") {
      d.awaiting = "amount";
      await ctx.editMessageText("Type the amount in USDC (e.g. 2.5):");
    } else {
      d.amount = Number(v);
      d.awaiting = "tagline";
      await ctx.editMessageText(`Amount $${d.amount}. Add a message (your call), or tap Skip:`, {
        reply_markup: new InlineKeyboard().text("Skip — open now", "skip"),
      });
    }
  } else if (data === "skip") {
    await finalize(ctx, uid, d, undefined);
  }
});

bot.on("message:text", async (ctx, next) => {
  const uid = ctx.from?.id;
  const d = uid ? drafts.get(uid) : undefined;
  if (!uid || !d || !d.awaiting) return next();
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next(); // let commands through
  if (d.awaiting === "amount") {
    const n = Number(text);
    if (!Number.isFinite(n) || n < MIN_AMOUNT || n > MAX_AMOUNT) {
      await ctx.reply(`Enter a number between ${MIN_AMOUNT} and ${MAX_AMOUNT}.`);
      return;
    }
    d.amount = n;
    d.awaiting = "tagline";
    await ctx.reply(`Amount $${n}. Add a message (your call), or /skip:`);
  } else if (d.awaiting === "tagline") {
    await finalize(ctx, uid, d, text);
  }
});

bot.command("skip", async (ctx) => {
  const uid = ctx.from?.id;
  const d = uid ? drafts.get(uid) : undefined;
  if (uid && d) await finalize(ctx, uid, d, undefined);
});

bot.command("wallet", async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  const addr = (ctx.match?.toString() ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    await ctx.reply("Usage: /wallet 0x… — your Arc address. That's where the agent pays your creator cut when your calls resolve.");
    return;
  }
  userWallets.set(uid, addr);
  persist();
  await ctx.reply(`✅ Wallet linked. The agent will pay your creator cut here when your calls resolve:\n${addr}`);
});

bot.command("start", (ctx) =>
  ctx.reply(
    "FUD-arc agent — turn a call into a real on-chain market on Arc.\n\n" +
      "📣 Guided:  /open\n⚡ Quick:  /long BTC 1  ·  /short ETH 1\n💸 /wallet 0x… — get paid your creator cut when your calls resolve\n\n" +
      `Symbols: ${ASSET_LIST}`,
  ),
);

// ── Metadata endpoint for the FE (binds Railway $PORT) + healthcheck ──
const PORT = Number(process.env.PORT ?? 3001);
createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("method not allowed");
    return;
  }
  const path = (req.url ?? "").split("?")[0];
  if (path === "/arc/markets-meta") {
    res.setHeader("Content-Type", "application/json");
    const out: Record<string, MetaEntry> = {};
    for (const [id, m] of registry) {
      out[id] = { ticker: m.ticker, kind: m.kind, side: m.side, timeframe: m.timeframe, pythId: m.pythId, anchor: m.anchor, caller: m.caller, call: m.call, takes: m.takes };
    }
    res.end(JSON.stringify({ markets: out }));
  } else if (path === "/" || path === "/health") {
    res.end("fud-arc bot ok");
  } else {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(PORT, () => console.log(`[http] markets-meta + health on :${PORT}`));

bot.catch((err) => console.error("[bot] error:", (err.error as Error)?.message ?? err.message));

// Register the command menu so they show up under "/" in Telegram.
await bot.api.setMyCommands([
  { command: "open", description: "Make a call → open a market" },
  { command: "long", description: "Quick long (e.g. /long BTC 1)" },
  { command: "short", description: "Quick short (e.g. /short ETH 1)" },
  { command: "wallet", description: "Link your wallet for creator payouts" },
  { command: "start", description: "What this bot does" },
]);

// ── Resolver: at close, settle the market via the Pyth price, then pay the creator
// their cut (a real on-chain nano-payment from the agent → the caller's wallet). ──
const RESOLVE_POLL_MS = 60_000;
const OPENER_CUT_BPS = 2000n; // contract constant: opener earns 20% of the fee
const BPS = 10000n;
const MAX_CUT_UNITS = BigInt(MAX_AMOUNT) * 1_000_000n; // sanity cap on any payout
let tickRunning = false;

async function resolverTick(): Promise<void> {
  if (tickRunning) return; // never overlap ticks (a slow tick can outlast the interval)
  tickRunning = true;
  try {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, rec] of registry) {
      if (rec.resolved || now < rec.closesAt) continue;
      try {
        const m = await readMarket(BigInt(id));
        if (m.outcome === 0) {
          const price = await pythPrice(rec.pythId);
          if (price == null) continue; // no fresh price → retry next tick
          // anchor 0 (price unavailable at open) → draw; otherwise by the move vs entry.
          const outcome: Outcome = rec.anchor > 0 ? (price > rec.anchor ? 1 : price < rec.anchor ? 2 : 3) : 3;
          await resolveMarket(BigInt(id), outcome);
          console.log(`[resolve] #${id} ${rec.ticker} → ${outcome === 1 ? "LONG" : outcome === 2 ? "SHORT" : "DRAW"} (entry ${rec.anchor} → ${price})`);
        }
        // Mark resolved + persist BEFORE paying — guarantees no double-pay across a
        // restart (a failed payout is the operator's small loss, never a re-pay).
        rec.resolved = true;
        persist();

        // Per-market creator cut from the on-chain fee (NOT a global accumulator delta).
        const fee = (await readMarket(BigInt(id))).fee;
        let cut = (fee * OPENER_CUT_BPS) / BPS;
        if (cut > MAX_CUT_UNITS) cut = 0n; // guard against an unexpected value
        const uid = rec.callerUid;
        const wallet = uid != null ? userWallets.get(uid) : undefined;
        if (cut > 0n && wallet) {
          await payUsdc(wallet, cut);
          const usdc = (Number(cut) / 1e6).toFixed(4);
          console.log(`[pay] #${id} ${usdc} USDC → ${wallet}`);
          if (uid != null) {
            await bot.api
              .sendMessage(uid, `💸 Your call #${id} (${rec.ticker} ${rec.side.toUpperCase()}) resolved.\nCreator cut paid: ${usdc} USDC → your wallet.`)
              .catch(() => {});
          }
        }
      } catch (e) {
        console.error(`[resolve] #${id} failed:`, (e as Error)?.message);
      }
    }
  } finally {
    tickRunning = false;
  }
}
setInterval(() => {
  resolverTick().catch((e) => console.error("[resolver]", (e as Error)?.message));
}, RESOLVE_POLL_MS);

bot.start({ onStart: (me) => console.log(`[bot] @${me.username} live · operator ${operatorAddress}`) });
