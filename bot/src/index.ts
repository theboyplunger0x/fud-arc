import "dotenv/config";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { createServer } from "node:http";
import { openAndMatch, usdcBalance, operatorAddress, type Side } from "./arc.js";
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
const registry = new Map<number, MetaEntry>();

const U = (n: number) => BigInt(Math.round(n * 1e6)); // USDC 6-dp units
const DAY = 86400;
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
    const closesAt = Math.floor(now / 1000) + DAY;
    const { marketId } = await openAndMatch({ closesAt, openerSide: s, openerAmount: U(amount), takerAmount: U(takerAmt) });
    const caller = ctx.from?.username ?? ctx.from?.first_name ?? "anon";
    registry.set(Number(marketId), {
      ticker: asset.ticker, kind: asset.kind, side, timeframe: "24h",
      pythId: asset.pythId, anchor: anchor ?? 0, caller, call: call?.slice(0, 140), takes: [],
    });
    await ctx.reply(
      `✅ Market #${marketId} opened on Arc\n${side === "long" ? "📈 LONG" : "📉 SHORT"} ${asset.ticker} · $${amount}` +
        `${call ? `\n“${call.slice(0, 140)}”` : ""}\nEntry: ${anchor ? "$" + fmtPrice(anchor) : "—"}\n\nLive → ${FE_URL}`,
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
  await doOpen(ctx, uid, asset, side, args[1] ? Number(args[1]) : 1);
}
bot.command("long", (ctx) => quick(ctx, "long"));
bot.command("short", (ctx) => quick(ctx, "short"));

// ── Guided flow: /open → asset → side → amount → tagline ──
interface Draft {
  asset?: AssetDef;
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
  if (!d.asset || !d.side || !d.amount) {
    await ctx.reply("Incomplete — /open to start again.");
    return;
  }
  await doOpen(ctx, uid, d.asset, d.side, d.amount, call);
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
    await ctx.editMessageText(`${d.asset?.ticker} — pick a side:`, {
      reply_markup: new InlineKeyboard().text("📈 Long", "s:long").text("📉 Short", "s:short"),
    });
  } else if (data.startsWith("s:")) {
    d.side = data.slice(2) as "long" | "short";
    await ctx.editMessageText(`${d.asset?.ticker} ${d.side.toUpperCase()} — amount:`, {
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

bot.command("start", (ctx) =>
  ctx.reply(
    "FUD-arc agent — turn a call into a real on-chain market on Arc.\n\n" +
      "📣 Guided:  /open\n⚡ Quick:  /long BTC 1  ·  /short ETH 1\n\n" +
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
  if (req.url?.startsWith("/arc/markets-meta")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ markets: Object.fromEntries(registry) }));
  } else if (req.url === "/" || req.url === "/health") {
    res.end("fud-arc bot ok");
  } else {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(PORT, () => console.log(`[http] markets-meta + health on :${PORT}`));

bot.catch((err) => console.error("[bot] error:", (err.error as Error)?.message ?? err.message));
bot.start({ onStart: (me) => console.log(`[bot] @${me.username} live · operator ${operatorAddress}`) });
