// Verify Arc's USDC model: is native gas (18-dec) the SAME ledger as the ERC20 at
// 0x3600 (6-dec)? If unified, one faucet/native transfer funds both gas + bets.
import "dotenv/config";
import { createPublicClient, http, defineChain, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ARC_RPC ?? "https://rpc.testnet.arc.network";
const USDC = getAddress(process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000");
const arc = defineChain({ id: 5042002, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pc = createPublicClient({ chain: arc, transport: http(RPC) });
const ERC20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

const addrs: string[] = [];
const op = (process.env.ARC_OPERATOR_KEY ?? "").trim();
if (op) addrs.push(privateKeyToAccount(`0x${op.replace(/^0x/, "")}` as `0x${string}`).address);
try {
  for (const w of JSON.parse(readFileSync(join(__dirname, "wallets.json"), "utf8")) as { name: string; address: string }[]) addrs.push(w.address);
} catch { /* no wallets yet */ }

for (const a of addrs) {
  const native = await pc.getBalance({ address: getAddress(a) });
  const erc20 = (await pc.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [getAddress(a)] })) as bigint;
  console.log(`${a}\n  native(18d): ${(Number(native) / 1e18).toFixed(4)}  ·  erc20(6d): ${(Number(erc20) / 1e6).toFixed(4)}  ·  ${native > 0n && erc20 > 0n && Math.abs(Number(native) / 1e18 - Number(erc20) / 1e6) < 0.01 ? "UNIFIED ✓" : "separate?"}`);
}
process.exit(0);
