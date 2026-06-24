// Self-contained Arc chain module — the ONLY on-chain logic the bot needs.
// Mirrors the proven openAndMatchOnArc path (house model: operator funds both sides).
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseEventLogs,
  getAddress,
  type Address,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC = process.env.ARC_RPC ?? "https://rpc.testnet.arc.network";
const MARKET = getAddress(process.env.FUDARCMARKET_ADDRESS ?? "0x57352a7983E57De691fcEa5d7544CF6a398c0bf1") as Address;
const USDC = getAddress(process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address;
const KEY = (process.env.ARC_OPERATOR_KEY ?? "").trim();
const APPROVE_UNITS = BigInt(process.env.ARC_APPROVE_UNITS ?? "1000000000000"); // 1M USDC, bounded

if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) {
  throw new Error("ARC_OPERATOR_KEY missing or malformed (need 0x + 64 hex chars)");
}

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  testnet: true,
});

const MARKET_ABI = JSON.parse(readFileSync(join(__dirname, "abi/FudArcMarket.json"), "utf8")) as Abi;
const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const account = privateKeyToAccount(KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });

export const operatorAddress = account.address;
export const MARKET_ADDRESS = MARKET;
export type Side = 0 | 1; // 0 = Long, 1 = Short

export async function usdcBalance(): Promise<bigint> {
  return (await publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;
}

async function ensureAllowance(needed: bigint): Promise<void> {
  const current = (await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: "allowance", args: [account.address, MARKET],
  })) as bigint;
  if (current >= needed) return;
  const grant = needed > APPROVE_UNITS ? needed : APPROVE_UNITS;
  const hash = await walletClient.writeContract({ address: USDC, abi: ERC20_ABI, functionName: "approve", args: [MARKET, grant] });
  await publicClient.waitForTransactionReceipt({ hash });
}

/** House model: open on `openerSide`, immediately take the opposite. Amounts are 6-dp USDC units. */
export async function openAndMatch(params: {
  closesAt: number;
  openerSide: Side;
  openerAmount: bigint;
  takerAmount?: bigint;
}): Promise<{ marketId: bigint; openTx: `0x${string}`; betTx: `0x${string}` }> {
  const openerAmount = params.openerAmount;
  const takerAmount = params.takerAmount ?? openerAmount;
  const takerSide: Side = params.openerSide === 0 ? 1 : 0;

  await ensureAllowance(openerAmount + takerAmount);

  const openTx = await walletClient.writeContract({
    address: MARKET, abi: MARKET_ABI, functionName: "openMarket",
    args: [BigInt(params.closesAt), params.openerSide, openerAmount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: openTx });
  const opened = parseEventLogs({ abi: MARKET_ABI, eventName: "MarketOpened", logs: receipt.logs });
  const marketId = (opened[0] as { args?: { id?: bigint } } | undefined)?.args?.id;
  if (marketId === undefined) throw new Error("MarketOpened id not found in receipt");

  const betTx = await walletClient.writeContract({
    address: MARKET, abi: MARKET_ABI, functionName: "bet", args: [marketId, takerSide, takerAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: betTx });

  return { marketId, openTx, betTx };
}
