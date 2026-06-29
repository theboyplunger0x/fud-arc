import "dotenv/config";
import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openAndMatch, usdcBalance, operatorAddress, readMarket, resolveMarket, payUsdc, nextMarketId, type Side, type Outcome } from "./arc.js";
import { resolutionPrice } from "./genlayer.js";
import { resolveAsset, assetPrice, fmtPrice, ASSETS, ASSET_LIST, type AssetDef } from "./markets.js";

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
  invertPyth?: boolean;
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

interface ResolutionProof {
  marketId: number;
  ticker: string;
  anchor: number;
  price: number;
  outcome: "long" | "short" | "draw";
  via: string;
  sources?: string[];
  confidence?: string;
  oracleAddress?: string;
  genlayerResolveHash?: string;
  arcResolveTx: string;
  resolvedAt: number;
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
  15: {
    ticker: "BTC", kind: "crypto", side: "long", timeframe: "24h",
    pythId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    anchor: 59628.293836050005, call: "btc reclaiming the range — long into the close", caller: "fudagent",
    takes: [], closesAt: 1782595080, resolved: false,
  },
  16: {
    ticker: "EUR/USD", kind: "fx", side: "long", timeframe: "24h",
    pythId: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
    anchor: 1.13833, call: "dollar fading, euro bid — eur/usd long", caller: "fudagent",
    takes: [], closesAt: 1782595181, resolved: false,
  },
  17: {
    ticker: "JPY/USD", kind: "fx", side: "short", timeframe: "24h",
    pythId: "ef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52", invertPyth: true,
    anchor: 0.006182647780738579, call: "yen keeps bleeding — short jpy", caller: "fudagent",
    takes: [], closesAt: 1782595188, resolved: false,
  },
  // 1-week markets (opened 2026-06-28) so the board stays populated for the demo.
  18: {
    ticker: "SOL", kind: "crypto", side: "long", timeframe: "7d",
    pythId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    anchor: 71.52191472, call: "sol coiling under resistance — long the breakout into next week", caller: "fudagent",
    takes: [
      { user: "bot_alpha", text: "sol szn loading", side: "long" },
      { user: "bot_bravo", text: "free money tbh", side: "long" },
      { user: "bot_charlie", text: "this dumps, fading", side: "short" },
      { user: "bot_delta", text: "sending it", side: "long" },
      { user: "bot_echo", text: "bottom is in", side: "long" },
    ],
    closesAt: 1783258087, resolved: false,
  },
  19: {
    ticker: "BTC", kind: "crypto", side: "long", timeframe: "7d",
    pythId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    anchor: 60022.19499998, call: "btc holding the range, accumulation szn — long for the week", caller: "fudagent",
    takes: [
      { user: "bot_bravo", text: "accumulation confirmed", side: "long" },
      { user: "bot_charlie", text: "this prints", side: "long" },
      { user: "bot_delta", text: "top is in, short it", side: "short" },
      { user: "bot_alpha", text: "we eating good", side: "long" },
      { user: "bot_echo", text: "easy money", side: "long" },
      { user: "bot_bravo", text: "bears in shambles", side: "long" },
    ],
    closesAt: 1783258089, resolved: false,
  },
  20: {
    ticker: "GBP/USD", kind: "fx", side: "short", timeframe: "7d",
    pythId: "84c2dde9633d93d1bcad84e7dc41c9d56578b7ec52fabedc1f335d673df0a7c1",
    anchor: 1.3195400000000002, call: "cable overextended, dollar bid back — short gbp/usd", caller: "fudagent",
    takes: [
      { user: "bot_charlie", text: "cable rejected, short", side: "short" },
      { user: "bot_alpha", text: "dollar wrecking ball", side: "short" },
      { user: "bot_bravo", text: "nah pound rips, long", side: "long" },
      { user: "bot_delta", text: "locked in short", side: "short" },
      { user: "bot_echo", text: "free money tbh", side: "short" },
    ],
    closesAt: 1783258096, resolved: false,
  },
  21: {
    ticker: "EUR/USD", kind: "fx", side: "long", timeframe: "7d",
    pythId: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
    anchor: 1.13833, call: "euro reclaiming, dollar topping out — long eur/usd into next week", caller: "fudagent",
    takes: [
      { user: "bot_delta", text: "euro szn, long it", side: "long" },
      { user: "bot_echo", text: "dollar topping, agreed", side: "long" },
      { user: "bot_charlie", text: "nah dxy rips, fading", side: "short" },
      { user: "bot_alpha", text: "free money tbh", side: "long" },
      { user: "bot_bravo", text: "locked in", side: "long" },
    ],
    closesAt: 1783259408, resolved: false,
  },
};

// Persisted to a JSON file (Railway volume via DATA_DIR) so bot-opened markets +
// linked wallets survive restarts. Falls back to the cwd locally.
const DATA_DIR = process.env.DATA_DIR ?? ".";
const STORE = join(DATA_DIR, "store.json");

interface StoreShape {
  markets?: Record<string, MarketRec>;
  wallets?: Record<string, string>;
  resolutions?: ResolutionProof[];
}

function loadStore(): { registry: Map<number, MarketRec>; userWallets: Map<number, string>; resolutions: ResolutionProof[] } {
  try {
    if (!existsSync(STORE)) return { registry: new Map(), userWallets: new Map(), resolutions: [] };
    const raw = JSON.parse(readFileSync(STORE, "utf8")) as StoreShape;
    return {
      registry: new Map(Object.entries(raw.markets ?? {}).map(([k, v]) => [Number(k), v])),
      userWallets: new Map(Object.entries(raw.wallets ?? {}).map(([k, v]) => [Number(k), v])),
      resolutions: Array.isArray(raw.resolutions) ? raw.resolutions : [],
    };
  } catch (e) {
    console.error("[store] load failed:", (e as Error)?.message);
    return { registry: new Map(), userWallets: new Map(), resolutions: [] };
  }
}

function persist(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(
      STORE,
      JSON.stringify({ markets: Object.fromEntries(registry), wallets: Object.fromEntries(userWallets), resolutions }),
      { mode: 0o600 },
    );
  } catch (e) {
    console.error("[store] save failed:", (e as Error)?.message);
  }
}

const { registry, userWallets, resolutions } = loadStore();
const MAX_RESOLUTION_PROOFS = 50;

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

function cleanString(v: unknown, max: number): string | undefined {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
}

function cleanResolutionProof(v: unknown): ResolutionProof | null {
  const x = v as Partial<ResolutionProof> | null;
  if (!x || typeof x !== "object") return null;
  const marketId = Number(x.marketId);
  const anchor = Number(x.anchor);
  const price = Number(x.price);
  const resolvedAt = Number(x.resolvedAt);
  const outcome = x.outcome === "long" || x.outcome === "short" || x.outcome === "draw" ? x.outcome : null;
  const ticker = cleanString(x.ticker, 24);
  const via = cleanString(x.via, 40);
  const arcResolveTx = cleanString(x.arcResolveTx, 66);
  if (!Number.isInteger(marketId) || marketId <= 0 || !Number.isFinite(anchor) || anchor < 0) return null;
  if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(resolvedAt) || resolvedAt <= 0) return null;
  if (!outcome || !ticker || !via || !arcResolveTx || !/^0x[a-fA-F0-9]{64}$/.test(arcResolveTx)) return null;
  const sources = Array.isArray(x.sources)
    ? x.sources.map((s) => cleanString(s, 32)).filter((s): s is string => !!s).slice(0, 8)
    : undefined;
  const confidence = cleanString(x.confidence, 24);
  const oracleAddress = cleanString(x.oracleAddress, 42);
  const genlayerResolveHash = cleanString(x.genlayerResolveHash, 66);
  if (oracleAddress && !/^0x[a-fA-F0-9]{40}$/.test(oracleAddress)) return null;
  if (genlayerResolveHash && !/^0x[a-fA-F0-9]{64}$/.test(genlayerResolveHash)) return null;
  return {
    marketId,
    ticker,
    anchor,
    price,
    outcome,
    via,
    sources,
    confidence,
    oracleAddress,
    genlayerResolveHash,
    arcResolveTx,
    resolvedAt,
  };
}

function publicMetaEntries(): Map<number, MarketRec> {
  const out = new Map<number, MarketRec>();
  for (const [rawId, rec] of Object.entries(RESCUE_MARKETS)) out.set(Number(rawId), rec);
  for (const [id, rec] of registry) out.set(id, rec);
  return out;
}

function outcomeName(outcome: Outcome): ResolutionProof["outcome"] {
  return outcome === 1 ? "long" : outcome === 2 ? "short" : "draw";
}

function recordResolution(proof: ResolutionProof): void {
  const withoutDuplicate = resolutions.filter((r) => r.marketId !== proof.marketId);
  resolutions.length = 0;
  resolutions.push(proof, ...withoutDuplicate.slice(0, MAX_RESOLUTION_PROOFS - 1));
  persist();
}

const U = (n: number) => BigInt(Math.round(n * 1e6)); // USDC 6-dp units
const DAY = 86400;
const TIMEFRAMES: Record<string, number> = { "15m": 900, "1h": 3600, "24h": 86400, "7d": 604800 };
const DEFAULT_OPEN_AMOUNT = 1;
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
    await ctx.reply("Market configuration is invalid. Try again in a moment.");
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
    await ctx.reply("Operator wallet is low on USDC. Try again later.");
    return;
  }

  await ctx.reply(`⏳ Opening ${side.toUpperCase()} ${asset.ticker} on Arc…`);
  try {
    const anchor = await assetPrice(asset);
    const s: Side = side === "long" ? 0 : 1;
    const closesAt = Math.floor(now / 1000) + (TIMEFRAMES[timeframe] ?? DAY);
    const { marketId } = await openAndMatch({ closesAt, openerSide: s, openerAmount: U(amount), takerAmount: U(takerAmt) });
    const caller = ctx.from?.username ?? ctx.from?.first_name ?? "anon";
    registry.set(Number(marketId), {
      ticker: asset.ticker, kind: asset.kind, side, timeframe,
      pythId: asset.pythId, invertPyth: asset.invertPyth, anchor: anchor ?? 0, caller, call: call?.slice(0, 140), takes: [],
      closesAt, resolved: false, callerUid: uid, payoutWallet: effectivePayoutWallet,
    });
    persist();
    await ctx.reply(
      `✅ Market #${marketId} opened on Arc\n${side === "long" ? "📈 LONG" : "📉 SHORT"} ${asset.ticker} · ${timeframe}` +
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
    await ctx.reply(`Usage: /${side} <SYMBOL>\nNo wallet is needed to make the call.\nSymbols: ${ASSET_LIST}\ne.g. /${side} BTC`);
    return;
  }
  await doOpen(ctx, uid, asset, side, "24h", DEFAULT_OPEN_AMOUNT, undefined, userWallets.get(uid));
}
bot.command("long", (ctx) => quick(ctx, "long"));
bot.command("short", (ctx) => quick(ctx, "short"));

// ── Guided flow: /open → asset → timeframe → side → tagline → payout wallet ──
interface Draft {
  asset?: AssetDef;
  timeframe?: string;
  side?: "long" | "short";
  call?: string;
  payoutWallet?: string | null;
  awaiting?: "tagline" | "wallet";
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
    "No wallet is needed to make the call.\n\n" +
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
  if (!d.asset || !d.timeframe || !d.side) {
    await ctx.reply("Incomplete — /open to start again.");
    return;
  }
  await doOpen(ctx, uid, d.asset, d.side, d.timeframe, DEFAULT_OPEN_AMOUNT, call ?? d.call, d.payoutWallet);
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
    d.awaiting = "tagline";
    await ctx.editMessageText(`${d.asset?.ticker} ${d.side.toUpperCase()} · ${d.timeframe}\nAdd a message (your call), or tap Skip:`, {
      reply_markup: new InlineKeyboard().text("Skip message", "tagline:skip"),
    });
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
  if (d.awaiting === "tagline") {
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
      "📣 Guided:  /open\n⚡ Quick:  /long BTC  ·  /short ETH\n💸 /wallet 0x… — where creator fees should be paid\n\n" +
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
      out[id] = {
        ticker: m.ticker,
        kind: m.kind,
        side: m.side,
        timeframe: m.timeframe,
        pythId: m.pythId,
        invertPyth: m.invertPyth,
        anchor: m.anchor,
        caller: m.caller,
        call: m.call,
        takes: m.takes,
      };
    }
    res.end(JSON.stringify({ markets: out }));
  } else if (path === "/arc/resolutions" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ resolutions }));
  } else if (path === "/arc/resolutions" && req.method === "POST") {
    res.setHeader("Content-Type", "application/json");
    const token = process.env.RESOLUTION_WRITE_TOKEN;
    if (!token || req.headers["x-resolution-token"] !== token) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    try {
      const proof = cleanResolutionProof(await readJson(req, 8192));
      if (!proof) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid resolution proof" }));
        return;
      }
      recordResolution(proof);
      res.end(JSON.stringify({ ok: true, resolution: proof }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
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
  } else if (path === "/arc/markets-meta" || path === "/arc/resolutions" || path === "/arc/takes" || path === "/" || path === "/health") {
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
  { command: "long", description: "Quick long call" },
  { command: "short", description: "Quick short call" },
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
const warnedOrphans = new Set<number>();

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
    if (m && m.outcome === 0 && now >= m.closesAt && !warnedOrphans.has(id)) {
      warnedOrphans.add(id);
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
          const rp = await resolutionPrice(rec.ticker, rec.pythId, rec.invertPyth);
          if (rp == null) continue; // GenLayer and Pyth fallback both failed → retry next tick
          const price = rp.price;
          // anchor 0 (price unavailable at open) → draw; otherwise by the move vs entry.
          const outcome: Outcome = rec.anchor > 0 ? (price > rec.anchor ? 1 : price < rec.anchor ? 2 : 3) : 3;
          const arcResolveTx = await resolveMarket(BigInt(id), outcome);
          recordResolution({
            marketId: id,
            ticker: rec.ticker,
            anchor: rec.anchor,
            price,
            outcome: outcomeName(outcome),
            via: rp.via,
            sources: rp.sources,
            confidence: rp.confidence,
            oracleAddress: rp.oracleAddress,
            genlayerResolveHash: rp.resolveHash,
            arcResolveTx,
            resolvedAt: Math.floor(Date.now() / 1000),
          });
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
