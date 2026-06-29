import "dotenv/config";
import { openAndMatch, resolveMarket, usdcBalance, type Outcome } from "../src/arc.js";
import { resolutionPrice } from "../src/genlayer.js";
import { assetPrice, resolveAsset } from "../src/markets.js";

const BOT_HTTP = (process.env.BOT_HTTP_URL ?? "https://fud-arc-bot-production.up.railway.app").replace(/\/+$/, "");
const TOKEN = process.env.RESOLUTION_WRITE_TOKEN;
const AMOUNT = Number(process.env.SEED_RESOLUTION_AMOUNT ?? 0.05);
const CLOSE_DELAY_SEC = Number(process.env.SEED_RESOLUTION_CLOSE_SEC ?? 20);
const CASES = (process.env.SEED_RESOLUTION_CASES ?? "BTC,SOL,EURUSD")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!TOKEN) throw new Error("RESOLUTION_WRITE_TOKEN missing");
if (!Number.isFinite(AMOUNT) || AMOUNT <= 0) throw new Error("bad SEED_RESOLUTION_AMOUNT");
if (!Number.isFinite(CLOSE_DELAY_SEC) || CLOSE_DELAY_SEC < 10) throw new Error("bad SEED_RESOLUTION_CLOSE_SEC");

const U = (n: number) => BigInt(Math.round(n * 1e6));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function outcomeName(outcome: Outcome): "long" | "short" | "draw" {
  return outcome === 1 ? "long" : outcome === 2 ? "short" : "draw";
}

async function postProof(proof: unknown): Promise<void> {
  const res = await fetch(`${BOT_HTTP}/arc/resolutions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-resolution-token": TOKEN },
    body: JSON.stringify(proof),
  });
  if (!res.ok) throw new Error(`proof post failed ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

for (let i = 0; i < CASES.length; i++) {
  const sym = CASES[i];
  const asset = resolveAsset(sym);
  if (!asset) {
    console.warn(`[seed] skip unknown asset ${sym}`);
    continue;
  }
  const anchor = await assetPrice(asset);
  if (anchor == null || anchor <= 0) {
    console.warn(`[seed] skip ${asset.ticker}: no fresh anchor`);
    continue;
  }

  const bal = Number(await usdcBalance()) / 1e6;
  const needed = AMOUNT * 2;
  if (bal < needed) throw new Error(`operator low on USDC (${bal.toFixed(4)} < ${needed.toFixed(4)})`);

  const side = i % 2 === 0 ? 0 : 1;
  const closesAt = Math.floor(Date.now() / 1000) + CLOSE_DELAY_SEC;
  const { marketId } = await openAndMatch({
    closesAt,
    openerSide: side,
    openerAmount: U(AMOUNT),
    takerAmount: U(AMOUNT),
  });
  console.log(`[seed] #${marketId} ${asset.ticker} opened, anchor=${anchor}`);

  const waitMs = Math.max(0, (closesAt + 2) * 1000 - Date.now());
  if (waitMs > 0) await sleep(waitMs);

  const rp = await resolutionPrice(asset.ticker, asset.pythId, asset.invertPyth);
  if (!rp) throw new Error(`${asset.ticker}: no resolution price`);
  if (!rp.via.startsWith("genlayer:") && process.env.ALLOW_PYTH_SEED !== "1") {
    throw new Error(`${asset.ticker}: refusing to seed non-GenLayer proof (${rp.via})`);
  }

  const outcome: Outcome = anchor > 0 ? (rp.price > anchor ? 1 : rp.price < anchor ? 2 : 3) : 3;
  const arcResolveTx = await resolveMarket(marketId, outcome);
  const proof = {
    marketId: Number(marketId),
    ticker: asset.ticker,
    anchor,
    price: rp.price,
    outcome: outcomeName(outcome),
    via: rp.via,
    sources: rp.sources,
    confidence: rp.confidence,
    oracleAddress: rp.oracleAddress,
    genlayerResolveHash: rp.resolveHash,
    arcResolveTx,
    resolvedAt: Math.floor(Date.now() / 1000),
  };
  await postProof(proof);
  console.log(`[seed] #${marketId} ${asset.ticker} ${proof.outcome.toUpperCase()} via ${proof.via} posted`);
}

process.exit(0);
