// Real on-chain bettors: each funded trader wallet places a small bet on a random
// open market, leaning to the lighter side so pools stay two-sided. Pure wallet-sign
// (no operator, no DB) — exactly the FUD testnet "soft launch" idea, but on-chain on Arc.
//
//   npx tsx traders/trade.ts            # 1 round, each wallet bets once
//   TRADE_ROUNDS=3 npx tsx traders/trade.ts
import "dotenv/config";
import { createPublicClient, createWalletClient, http, defineChain, getAddress, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ARC_RPC ?? "https://rpc.testnet.arc.network";
const MARKET = getAddress(process.env.FUDARCMARKET_ADDRESS ?? "0x57352a7983E57De691fcEa5d7544CF6a398c0bf1");
const USDC = getAddress(process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000");

const arcTestnet = defineChain({
  id: 5042002, name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } }, testnet: true,
});

const MARKET_ABI = [
  { type: "function", name: "nextMarketId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "markets", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }, { type: "uint64" }, { type: "uint8" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "bet", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint8" }, { type: "uint256" }], outputs: [] },
] as const;
const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

interface Wallet { name: string; address: string; privateKey: `0x${string}`; }
const wallets: Wallet[] = JSON.parse(readFileSync(join(__dirname, "wallets.json"), "utf8"));

const ROUNDS = Number(process.env.TRADE_ROUNDS ?? 1);
const MIN_BET = Number(process.env.TRADE_MIN ?? 0.25);
const MAX_BET = Number(process.env.TRADE_MAX ?? 1.5);

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface OpenMkt { id: number; longPool: bigint; shortPool: bigint; }
async function openMarkets(): Promise<OpenMkt[]> {
  const next = Number(await publicClient.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "nextMarketId" }));
  const now = Math.floor(Date.now() / 1000);
  const out: OpenMkt[] = [];
  for (let id = 1; id < next; id++) {
    const m = (await publicClient.readContract({ address: MARKET, abi: MARKET_ABI, functionName: "markets", args: [BigInt(id)] })) as readonly [Address, bigint, number, bigint, bigint, bigint];
    if (Number(m[2]) === 0 && now < Number(m[1])) out.push({ id, longPool: m[3], shortPool: m[4] });
  }
  return out;
}

async function trade(w: Wallet, mkt: OpenMkt): Promise<void> {
  const account = privateKeyToAccount(w.privateKey);
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });
  const amount = +rand(MIN_BET, MAX_BET).toFixed(2);
  const units = parseUnits(amount.toFixed(2), 6);

  const bal = (await publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;
  if (bal < units) {
    console.warn(`  ${w.name.padEnd(11)} skip — fund ${account.address} (bal ${(Number(bal) / 1e6).toFixed(2)} < ${amount})`);
    return;
  }

  // Lean to the lighter side (70%) so markets stay two-sided, with noise.
  const lighterIsLong = mkt.longPool <= mkt.shortPool;
  const targetLong = Math.random() < 0.7 ? lighterIsLong : !lighterIsLong;
  const side: 0 | 1 = targetLong ? 0 : 1;

  const allowance = (await publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: "allowance", args: [account.address, MARKET] })) as bigint;
  if (allowance < units) {
    const ah = await walletClient.writeContract({ address: USDC, abi: ERC20_ABI, functionName: "approve", args: [MARKET, parseUnits("1000000", 6)] });
    const ar = await publicClient.waitForTransactionReceipt({ hash: ah, timeout: 60_000 }).catch(() => null);
    if (!ar || ar.status !== "success") throw new Error("approve failed/timed out");
  }
  const bh = await walletClient.writeContract({ address: MARKET, abi: MARKET_ABI, functionName: "bet", args: [BigInt(mkt.id), side, units] });
  const br = await publicClient.waitForTransactionReceipt({ hash: bh, timeout: 60_000 }).catch(() => null);
  if (br && br.status !== "success") throw new Error("bet reverted");
  console.log(`  ${w.name.padEnd(11)} $${amount} ${side === 0 ? "LONG " : "SHORT"} on #${mkt.id}   ${bh.slice(0, 12)}…`);
}

for (let r = 0; r < ROUNDS; r++) {
  const mkts = await openMarkets();
  if (!mkts.length) {
    console.log("No open markets to trade.");
    break;
  }
  console.log(`\nRound ${r + 1}/${ROUNDS} — ${mkts.length} open markets, ${wallets.length} traders`);
  for (const w of wallets) {
    const mkt = mkts[Math.floor(Math.random() * mkts.length)];
    try {
      await trade(w, mkt);
    } catch (e) {
      console.warn(`  ${w.name.padEnd(11)} failed: ${(e as Error)?.message?.slice(0, 90)}`);
    }
    await sleep(rand(800, 2500));
  }
}
console.log("\n✅ done");
process.exit(0);
