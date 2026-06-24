import "dotenv/config";
import { Bot, type Context } from "grammy";
import { createServer } from "node:http";
import { openAndMatch, usdcBalance, operatorAddress, type Side } from "./arc.js";
import { resolveAsset, pythPrice, fmtPrice, ASSET_LIST } from "./markets.js";

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
const COOLDOWN_MS = 10_000;
const lastOpen = new Map<number, number>(); // tgUserId → ts

const bot = new Bot(TOKEN);

async function handleOpen(ctx: Context, dir: "long" | "short"): Promise<void> {
  const uid = ctx.from?.id;
  if (!uid) return; // ignore channel posts / anonymous senders (no per-user rate slot)
  const now = Date.now();
  if (now - (lastOpen.get(uid) ?? 0) < COOLDOWN_MS) {
    await ctx.reply("Easy — one market every 10s.");
    return;
  }
  // Stamp synchronously right after the gate — closes the open-while-checking race.
  // Refunded (deleted) on any validation/balance/open failure below so typos don't cost a cooldown.
  lastOpen.set(uid, now);
  const fail = async (msg: string): Promise<void> => {
    lastOpen.delete(uid);
    await ctx.reply(msg);
  };

  const args = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  const sym = args[0];
  const amount = args[1] ? Number(args[1]) : 1;
  if (!sym) return fail(`Usage: /${dir} <SYMBOL> [amount]\nSymbols: ${ASSET_LIST}\ne.g. /${dir} BTC 1`);
  const asset = resolveAsset(sym);
  if (!asset) return fail(`Unknown symbol "${sym}". Try: ${ASSET_LIST}`);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > MAX_AMOUNT) {
    return fail(`Amount must be between 0.01 and ${MAX_AMOUNT} USDC.`);
  }

  const takerAmt = Math.max(0.5, +(amount * 0.6).toFixed(2));
  const bal = await usdcBalance();
  if (bal < U(amount) + U(takerAmt)) {
    return fail(`Operator wallet low on USDC (${(Number(bal) / 1e6).toFixed(2)}). Top up to open this market.`);
  }

  await ctx.reply(`⏳ Opening ${dir.toUpperCase()} ${asset.ticker} for $${amount} on Arc…`);
  try {
    const anchor = await pythPrice(asset.pythId);
    const side: Side = dir === "long" ? 0 : 1;
    const closesAt = Math.floor(now / 1000) + DAY;
    const { marketId } = await openAndMatch({
      closesAt, openerSide: side, openerAmount: U(amount), takerAmount: U(takerAmt),
    });
    const caller = ctx.from?.username ?? ctx.from?.first_name ?? "anon";
    registry.set(Number(marketId), {
      ticker: asset.ticker, kind: asset.kind, side: dir, timeframe: "24h",
      pythId: asset.pythId, anchor: anchor ?? 0, caller, takes: [],
    });
    await ctx.reply(
      `✅ Market #${marketId} opened on Arc\n${dir === "long" ? "📈 LONG" : "📉 SHORT"} ${asset.ticker} · $${amount}\nEntry: ${anchor ? "$" + fmtPrice(anchor) : "—"}\n\nLive → ${FE_URL}`,
    );
  } catch (e) {
    lastOpen.delete(uid); // failed open shouldn't burn the cooldown
    console.error("[open] failed:", (e as Error)?.message);
    const short = (e as { shortMessage?: string })?.shortMessage ?? "on-chain error — try again in a moment";
    await ctx.reply(`⚠️ Couldn't open the market: ${short.slice(0, 120)}`);
  }
}

bot.command("start", (ctx) =>
  ctx.reply(
    "FUD-arc agent — turn a call into a real on-chain market on Arc.\n\n/long <SYMBOL> [amount]\n/short <SYMBOL> [amount]\n\n" +
      `Symbols: ${ASSET_LIST}\nExample: /long BTC 1`,
  ),
);
bot.command("long", (ctx) => handleOpen(ctx, "long"));
bot.command("short", (ctx) => handleOpen(ctx, "short"));

// Metadata endpoint for the FE (binds Railway $PORT) + a healthcheck.
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
bot.start({
  onStart: (me) => console.log(`[bot] @${me.username} live · operator ${operatorAddress}`),
});
