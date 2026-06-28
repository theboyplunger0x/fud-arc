// Open a few real on-chain markets (house model) with real Pyth anchors, then print
// RESCUE_MARKETS entries to paste into bot/src/index.ts so the bot serves their meta.
// Tops up the operator from a trader wallet first (it funds both sides + pays cuts).
import "dotenv/config";
import { createWalletClient, http, defineChain, parseUnits, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openAndMatch, operatorAddress, usdcBalance } from "../src/arc.js";
import { resolveAsset, type AssetDef } from "../src/markets.js";

// Anchor = last Hermes price WITHOUT the 120s staleness guard, so FX off-hours
// (frozen feed) still gives a real entry. Applies the pair inversion (JPY/USD).
async function rawAnchor(asset: AssetDef): Promise<number | null> {
  try {
    const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${asset.pythId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { parsed?: { price: { price: string; expo: number } }[] };
    const p = data.parsed?.[0]?.price;
    if (!p) return null;
    const raw = Number(p.price) * 10 ** p.expo;
    return asset.invertPyth && raw > 0 ? 1 / raw : raw;
  } catch {
    return null;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ARC_RPC ?? "https://rpc.testnet.arc.network";
const arc = defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } }, testnet: true });

const U = (n: number) => BigInt(Math.round(n * 1e6));
const TF = 604800; // 1 week — keep markets open for the demo (24h ones expire too fast)
const TF_LABEL = "7d";
const AMT = 0.6; // operator funds each side; bots add liquidity on top
const TOPUP_MIN = 2;
const TOPUP_AMT = 5;

const PLAN = [
  { sym: "EURUSD", side: "long" as const, call: "euro reclaiming, dollar topping out — long eur/usd into next week", caller: "fudarc" },
];

const bal0 = Number(await usdcBalance()) / 1e6;
console.log(`operator ${operatorAddress} = ${bal0.toFixed(2)} USDC`);
if (bal0 < TOPUP_MIN) {
  const w = (JSON.parse(readFileSync(join(__dirname, "wallets.json"), "utf8")) as { name: string; privateKey: `0x${string}` }[])[1];
  const wc = createWalletClient({ account: privateKeyToAccount(w.privateKey), chain: arc, transport: http(RPC) });
  const h = await wc.sendTransaction({ to: getAddress(operatorAddress), value: parseUnits(String(TOPUP_AMT), 18) });
  console.log(`topped up operator +${TOPUP_AMT} from ${w.name} (${h.slice(0, 12)}…)`);
  await new Promise((r) => setTimeout(r, 5000));
}

interface Entry { id: number; ticker: string; kind: string; side: string; pythId: string; invertPyth?: boolean; anchor: number; call: string; caller: string; closesAt: number }
const out: Entry[] = [];
for (const p of PLAN) {
  const asset = resolveAsset(p.sym);
  if (!asset) { console.warn(`unknown ${p.sym}`); continue; }
  const anchor = await rawAnchor(asset);
  if (anchor == null) { console.warn(`no price for ${p.sym}`); continue; }
  const closesAt = Math.floor(Date.now() / 1000) + TF;
  const { marketId } = await openAndMatch({ closesAt, openerSide: p.side === "long" ? 0 : 1, openerAmount: U(AMT), takerAmount: U(AMT) });
  console.log(`✅ #${marketId} ${asset.ticker} ${p.side} anchor=${anchor}`);
  out.push({ id: Number(marketId), ticker: asset.ticker, kind: asset.kind, side: p.side, pythId: asset.pythId, invertPyth: asset.invertPyth, anchor, call: p.call, caller: p.caller, closesAt });
}

console.log("\n=== RESCUE_MARKETS entries (paste into bot/src/index.ts) ===");
for (const e of out) {
  const inv = e.invertPyth ? " invertPyth: true," : "";
  console.log(`  ${e.id}: { ticker: ${JSON.stringify(e.ticker)}, kind: ${JSON.stringify(e.kind)}, timeframe: ${JSON.stringify(TF_LABEL)}, side: ${JSON.stringify(e.side)}, pythId: ${JSON.stringify(e.pythId)},${inv} anchor: ${e.anchor}, call: ${JSON.stringify(e.call)}, caller: ${JSON.stringify(e.caller)}, takes: [], closesAt: ${e.closesAt}, resolved: false },`);
}
process.exit(0);
