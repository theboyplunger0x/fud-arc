import "dotenv/config";
import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openAndMatch, usdcBalance, operatorAddress, readMarket, resolveMarket, payUsdc, nextMarketId, type Side, type Outcome } from "./arc.js";
import { resolutionPrice } from "./genlayer.js";
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
  payoutWallet?: string;
}

const RESCUE_MARKETS: Record<number, MarketRec> = {
  5: {
    ticker: "BTC", kind: "crypto", side: "long", timeframe: "24h",
    pythId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    anchor: 60666, takes: [], closesAt: 1782421342, resolved: false,
  },
  6: {
    ticker: "ETH", kind: "crypto", side: "short", timeframe: "7d",
    pythId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    anchor: 1607, takes: [], closesAt: 1782939742, resolved: false,
  },
  7: {
    ticker: "EUR/USD", kind: "fx", side: "long", timeframe: "24h",
    pythId: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
    anchor: 1.1361, takes: [], closesAt: 1782421342, resolved: false,
  },
};

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

const MAX_TAKE_TEXT = 80;
const MAX_TAKES_PER_MARKET = 25;

async function readJson(req: IncomingMessage, maxBytes = 4096): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

function cleanTakeUser(user: unknown, fallback: string): string {
  const cleaned = String(user ?? fallback).trim().replace(/^@/, "").replace(/[^\w.-]/g, "").slice(0, 24);
  return cleaned || fallback;
}

function cleanTakeText(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TAKE_TEXT);
}

function publicMetaEntries(): Map<number, MarketRec> {
  const out = new Map<number, MarketRec>();
  for (const [rawId, rec] of Object.entries(RESCUE_MARKETS)) out.set(Number(rawId), rec);
  for (const [id, rec] of registry) out.set(id, rec);
  return out;
}

const U = (n: number) => BigInt(Math.round(n * 1e6)); // USDC 6-dp units
const DAY = 86400;
const TIMEFRAMES: Record<string, number> = { "15m": 900, "1h": 3600, "24h": 86400, "7d": 604800 };
const MAX_AMOUNT = 5;
const MIN_AMOUNT = 0.01;
const COOLDOWN_MS = 10_000;
const lastOpen = new Map<number, number>(); // tgUserId → ts

const bot = new Bot(TOKEN);

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

function normalizeWallet(input: string): string | null {
  const addr = input.trim();
  return WALLET_RE.test(addr) ? addr : null;
}

function shortWallet(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ── Shared open path (used by quick commands + the guided flow) ──
async function doOpen(
  ctx: Context,
  uid: number,
  asset: AssetDef,
  side: "long" | "short",
  timeframe: string,
  amount: number,
  call?: string,
  payoutWallet?: string | null,
): Promise<void> {
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    await ctx.reply(`Market seed must be between ${MIN_AMOUNT} and ${MAX_AMOUNT} USDC.`);
    return;
  }
  const effectivePayoutWallet = payoutWallet === null ? undefined : payoutWallet ?? userWallets.get(uid);
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

  await ctx.reply(`⏳ Opening ${side.toUpperCase()} ${asset.ticker} with a bot-funded $${amount} seed on Arc…`);
  try {
    const anchor = await pythPrice(asset.pythId);
    const s: Side = side === "long" ? 0 : 1;
    const closesAt = Math.floor(now / 1000) + (TIMEFRAMES[timeframe] ?? DAY);
    const { marketId } = await openAndMatch({ closesAt, openerSide: s, openerAmount: U(amount), takerAmount: U(takerAmt) });
    const caller = ctx.from?.username ?? ctx.from?.first_name ?? "anon";
    registry.set(Number(marketId), {
      ticker: asset.ticker, kind: asset.kind, side, timeframe,
      pythId: asset.pythId, anchor: anchor ?? 0, caller, call: call?.slice(0, 140), takes: [],
      closesAt, resolved: false, callerUid: uid, payoutWallet: effectivePayoutWallet,
    });
    persist();
    await ctx.reply(
      `✅ Market #${marketId} opened on Arc\n${side === "long" ? "📈 LONG" : "📉 SHORT"} ${asset.ticker} · ${timeframe} · seed $${amount}` +
        `${call ? `\n“${call.slice(0, 140)}”` : ""}\nEntry: ${anchor ? "$" + fmtPrice(anchor) : "—"}` +
        `\nCreator cut → ${effectivePayoutWallet ? shortWallet(effectivePayoutWallet) : "no wallet yet (/wallet 0x… before resolve)"}` +
        `\n\nLive → ${FE_URL}`,
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
    await ctx.reply(`Usage: /${side} <SYMBOL> [seed]\nThe bot funds the seed; no wallet is needed to make the call.\nSymbols: ${ASSET_LIST}\ne.g. /${side} BTC 1`);
    return;
  }
  await doOpen(ctx, uid, asset, side, "24h", args[1] ? Number(args[1]) : 1, undefined, userWallets.get(uid));
}
bot.command("long", (ctx) => quick(ctx, "long"));
bot.command("short", (ctx) => quick(ctx, "short"));

// ── Guided flow: /open → asset → side → amount → tagline ──
interface Draft {
  asset?: AssetDef;
  timeframe?: string;
  side?: "long" | "short";
  amount?: number;
  call?: string;
  payoutWallet?: string | null;
  awaiting?: "amount" | "tagline" | "wallet";
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

function payoutKeyboard(uid: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const saved = userWallets.get(uid);
  if (saved) kb.text(`Use saved ${shortWallet(saved)}`, "w:saved").row();
  kb.text("Paste wallet", "w:paste").text("Skip for now", "w:skip");
  return kb;
}

async function askPayoutWallet(ctx: Context, uid: number, d: Draft, mode: "edit" | "reply"): Promise<void> {
  d.awaiting = "wallet";
  const saved = userWallets.get(uid);
  const text =
    "💸 Creator fee wallet\n" +
    "The bot opens this market with the operator wallet, so you do not need a wallet to make the call.\n\n" +
    "Where should the creator cut be sent after resolve?\n" +
    `${saved ? `Saved: ${shortWallet(saved)}\n` : ""}` +
    "Paste an Arc wallet (0x…), use saved, or skip and link one later with /wallet before resolve.";
  const reply_markup = payoutKeyboard(uid);
  if (mode === "edit") {
    await ctx.editMessageText(text, { reply_markup }).catch(() => ctx.reply(text, { reply_markup }));
  } else {
    await ctx.reply(text, { reply_markup });
  }
}

async function finalize(ctx: Context, uid: number, d: Draft, call?: string): Promise<void> {
  drafts.delete(uid);
  if (!d.asset || !d.timeframe || !d.side || !d.amount) {
    await ctx.reply("Incomplete — /open to start again.");
    return;
  }
  await doOpen(ctx, uid, d.asset, d.side, d.timeframe, d.amount, call ?? d.call, d.payoutWallet);
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
    await ctx.editMessageText(`${d.asset?.ticker} ${d.side.toUpperCase()} · ${d.timeframe} — market seed (bot-funded):`, {
      reply_markup: new InlineKeyboard().text("$1", "amt:1").text("$5", "amt:5").text("$10", "amt:10").row().text("✏️ Custom", "amt:custom"),
    });
  } else if (data.startsWith("amt:")) {
    const v = data.slice(4);
    if (v === "custom") {
      d.awaiting = "amount";
      await ctx.editMessageText("Type the market seed in USDC (e.g. 2.5). The bot funds it; no wallet is needed to make the call.");
    } else {
      d.amount = Number(v);
      d.awaiting = "tagline";
      await ctx.editMessageText(`Seed $${d.amount}. Add a message (your call), or tap Skip:`, {
        reply_markup: new InlineKeyboard().text("Skip message", "tagline:skip"),
      });
    }
  } else if (data === "tagline:skip") {
    d.call = undefined;
    await askPayoutWallet(ctx, uid, d, "edit");
  } else if (data === "w:paste") {
    d.awaiting = "wallet";
    await ctx.editMessageText("Paste the Arc wallet that should receive creator fees (0x…), or /skip to open without one.");
  } else if (data === "w:saved") {
    const saved = userWallets.get(uid);
    if (!saved) {
      await askPayoutWallet(ctx, uid, d, "edit");
      return;
    }
    d.payoutWallet = saved;
    await finalize(ctx, uid, d);
  } else if (data === "w:skip") {
    d.payoutWallet = null;
    await finalize(ctx, uid, d);
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
    await ctx.reply(`Seed $${n}. Add a message (your call), or /skip:`);
  } else if (d.awaiting === "tagline") {
    d.call = text;
    await askPayoutWallet(ctx, uid, d, "reply");
  } else if (d.awaiting === "wallet") {
    const wallet = normalizeWallet(text);
    if (!wallet) {
      await ctx.reply("That does not look like an Arc/EVM wallet. Paste a 0x address, or /skip to open without one.");
      return;
    }
    d.payoutWallet = wallet;
    userWallets.set(uid, wallet);
    persist();
    await finalize(ctx, uid, d);
  }
});

bot.command("skip", async (ctx) => {
  const uid = ctx.from?.id;
  const d = uid ? drafts.get(uid) : undefined;
  if (!uid || !d) return;
  if (d.awaiting === "tagline") {
    d.call = undefined;
    await askPayoutWallet(ctx, uid, d, "reply");
  } else if (d.awaiting === "wallet") {
    d.payoutWallet = null;
    await finalize(ctx, uid, d);
  } else {
    await finalize(ctx, uid, d, undefined);
  }
});

bot.command("wallet", async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  const addr = (ctx.match?.toString() ?? "").trim();
  const wallet = normalizeWallet(addr);
  if (!wallet) {
    await ctx.reply("Usage: /wallet 0x… — your Arc address. That's where the agent pays your creator cut when your calls resolve.");
    return;
  }
  userWallets.set(uid, wallet);
  persist();
  const d = drafts.get(uid);
  if (d?.awaiting === "wallet") {
    d.payoutWallet = wallet;
    await ctx.reply(`✅ Wallet linked for this call: ${wallet}`);
    await finalize(ctx, uid, d);
    return;
  }
  await ctx.reply(`✅ Wallet linked. The agent will pay your creator cut here when your calls resolve:\n${wallet}`);
});

bot.command("start", (ctx) =>
  ctx.reply(
    "FUD-arc agent — turn a call into a real on-chain market on Arc.\n\n" +
      "📣 Guided:  /open\n⚡ Quick:  /long BTC 1  ·  /short ETH 1\n💸 /wallet 0x… — where creator fees should be paid\n\n" +
      `Symbols: ${ASSET_LIST}`,
  ),
);

// ── Metadata endpoint for the FE (binds Railway $PORT) + healthcheck ──
const PORT = Number(process.env.PORT ?? 3001);
const httpServer = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const path = (req.url ?? "").split("?")[0];
  if (path === "/arc/markets-meta" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    const out: Record<string, MetaEntry> = {};
    for (const [id, m] of publicMetaEntries()) {
      out[id] = { ticker: m.ticker, kind: m.kind, side: m.side, timeframe: m.timeframe, pythId: m.pythId, anchor: m.anchor, caller: m.caller, call: m.call, takes: m.takes };
    }
    res.end(JSON.stringify({ markets: out }));
  } else if (path === "/arc/takes" && req.method === "POST") {
    res.setHeader("Content-Type", "application/json");
    try {
      const body = (await readJson(req)) as { marketId?: unknown; side?: unknown; text?: unknown; user?: unknown; address?: unknown };
      const marketId = Number(body.marketId);
      const side = body.side === "long" || body.side === "short" ? body.side : null;
      const text = cleanTakeText(body.text);
      const fallbackUser = typeof body.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(body.address)
        ? `${body.address.slice(0, 6)}…${body.address.slice(-4)}`
        : "anon";
      const user = cleanTakeUser(body.user, fallbackUser);
      if (!Number.isInteger(marketId) || marketId <= 0 || !side || !text) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid take" }));
        return;
      }
      const rec = registry.get(marketId) ?? RESCUE_MARKETS[marketId];
      if (!rec) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "market metadata not found" }));
        return;
      }
      rec.takes.push({ user, text, side });
      if (rec.takes.length > MAX_TAKES_PER_MARKET) rec.takes = rec.takes.slice(-MAX_TAKES_PER_MARKET);
      if (!registry.has(marketId)) registry.set(marketId, rec);
      persist();
      res.end(JSON.stringify({ ok: true, take: rec.takes[rec.takes.length - 1] }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  } else if ((path === "/" || path === "/health") && req.method === "GET") {
    res.end("fud-arc bot ok");
  } else if (path === "/arc/markets-meta" || path === "/arc/takes" || path === "/" || path === "/health") {
    res.statusCode = 405;
    res.end("method not allowed");
  } else {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(PORT, () => console.log(`[http] markets-meta + health on :${PORT}`));

bot.catch((err) => console.error("[bot] error:", (err.error as Error)?.message ?? err.message));

// Register the command menu so they show up under "/" in Telegram.
await bot.api.setMyCommands([
  { command: "open", description: "Make a call → open a market" },
  { command: "long", description: "Quick long with bot-funded seed" },
  { command: "short", description: "Quick short with bot-funded seed" },
  { command: "wallet", description: "Set creator fee payout wallet" },
  { command: "start", description: "What this bot does" },
]);

// ── Resolver: at close, settle the market via the Pyth price, then pay the creator
// their cut (a real on-chain nano-payment from the agent → the caller's wallet). ──
const RESOLVE_POLL_MS = 60_000;
const OPENER_CUT_BPS = 2000n; // contract constant: opener earns 20% of the fee
const BPS = 10000n;
const MAX_CUT_UNITS = BigInt(MAX_AMOUNT) * 1_000_000n; // sanity cap on any payout
let tickRunning = false;

async function resolverCandidates(now: number): Promise<Map<number, MarketRec>> {
  const out = new Map(registry);
  for (const [rawId, rec] of Object.entries(RESCUE_MARKETS)) {
    const id = Number(rawId);
    if (!out.has(id)) out.set(id, rec);
  }

  const next = Number(await nextMarketId().catch(() => 0n));
  for (let id = 1; id < next; id++) {
    if (out.has(id)) continue;
    const m = await readMarket(BigInt(id)).catch(() => null);
    if (m && m.outcome === 0 && now >= m.closesAt) {
      console.warn(`[resolve] #${id} is closed/unresolved but has no metadata; leaving it unresolved until a rescue entry is added.`);
    }
  }
  return out;
}

async function resolverTick(): Promise<void> {
  if (tickRunning) return; // never overlap ticks (a slow tick can outlast the interval)
  tickRunning = true;
  try {
    const now = Math.floor(Date.now() / 1000);
    const candidates = await resolverCandidates(now);
    for (const [id, rec] of candidates) {
      if (rec.resolved) continue;
      try {
        const m = await readMarket(BigInt(id));
        if (now < m.closesAt) continue;
        if (m.outcome === 0) {
          const rp = await resolutionPrice(rec.ticker, rec.pythId);
          if (rp == null) continue; // GenLayer and Pyth fallback both failed → retry next tick
          const price = rp.price;
          // anchor 0 (price unavailable at open) → draw; otherwise by the move vs entry.
          const outcome: Outcome = rec.anchor > 0 ? (price > rec.anchor ? 1 : price < rec.anchor ? 2 : 3) : 3;
          await resolveMarket(BigInt(id), outcome);
          console.log(`[resolve] #${id} ${rec.ticker} → ${outcome === 1 ? "LONG" : outcome === 2 ? "SHORT" : "DRAW"} via ${rp.via} (entry ${rec.anchor} → ${price})`);
        }
        // Mark resolved + persist BEFORE paying — guarantees no double-pay across a
        // restart (a failed payout is the operator's small loss, never a re-pay).
        rec.resolved = true;
        if (registry.has(id)) persist();

        // Per-market creator cut from the on-chain fee (NOT a global accumulator delta).
        const fee = (await readMarket(BigInt(id))).fee;
        let cut = (fee * OPENER_CUT_BPS) / BPS;
        if (cut > MAX_CUT_UNITS) cut = 0n; // guard against an unexpected value
        const uid = rec.callerUid;
        const wallet = rec.payoutWallet ?? (uid != null ? userWallets.get(uid) : undefined);
        if (cut > 0n && wallet) {
          await payUsdc(wallet, cut);
          const usdc = (Number(cut) / 1e6).toFixed(4);
          console.log(`[pay] #${id} ${usdc} USDC → ${wallet}`);
          if (uid != null) {
            await bot.api
              .sendMessage(uid, `💸 Your call #${id} (${rec.ticker} ${rec.side.toUpperCase()}) resolved.\nCreator cut paid: ${usdc} USDC → your wallet.`)
              .catch(() => {});
          }
        } else if (cut > 0n) {
          console.log(`[pay] #${id} creator cut accrued but no payout wallet is set`);
        }
      } catch (e) {
        console.error(`[resolve] #${id} failed:`, (e as Error)?.message);
      }
    }
  } finally {
    tickRunning = false;
  }
}
const resolverTimer = setInterval(() => {
  resolverTick().catch((e) => console.error("[resolver]", (e as Error)?.message));
}, RESOLVE_POLL_MS);

function isPollingConflict(e: unknown): boolean {
  return e instanceof GrammyError && e.error_code === 409;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startPolling(): Promise<void> {
  let attempt = 0;
  for (;;) {
    try {
      await bot.start({ onStart: (me) => console.log(`[bot] @${me.username} live · operator ${operatorAddress}`) });
      return;
    } catch (e) {
      if (!isPollingConflict(e)) throw e;
      attempt += 1;
      const delay = Math.min(30_000, 5_000 + attempt * 5_000);
      console.warn(`[bot] Telegram polling conflict during startup/rollout; retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[bot] ${signal} received; shutting down`);
  clearInterval(resolverTimer);
  if (bot.isRunning()) {
    await bot.stop().catch((e) => console.warn("[bot] stop failed:", (e as Error)?.message));
  }
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

startPolling().catch((e) => {
  console.error("[bot] fatal:", (e as Error)?.message);
  process.exit(1);
});
