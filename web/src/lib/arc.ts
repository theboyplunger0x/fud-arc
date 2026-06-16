import { createPublicClient, http, defineChain } from "viem";
import abi from "./fudArcMarketAbi.json";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  testnet: true,
});

export const MARKET_ADDRESS = "0x57352a7983E57De691fcEa5d7544CF6a398c0bf1" as const;
export const EXPLORER = "https://testnet.arcscan.app";

const client = createPublicClient({ chain: arcTestnet, transport: http() });

export type Outcome = 0 | 1 | 2 | 3; // Unresolved, Long, Short, Draw

export interface Market {
  id: number;
  opener: string;
  closesAt: number; // unix seconds
  outcome: Outcome;
  longPool: bigint; // 6-decimal USDC units
  shortPool: bigint;
  fee: bigint;
}

// markets(id) getter returns the flattened struct in declaration order.
type MarketTuple = readonly [string, bigint, number, bigint, bigint, bigint];

export async function readMarkets(): Promise<Market[]> {
  const next = (await client.readContract({
    address: MARKET_ADDRESS,
    abi,
    functionName: "nextMarketId",
  })) as bigint;

  const count = Number(next) - 1;
  if (count <= 0) return [];

  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const rows = (await Promise.all(
    ids.map((id) =>
      client.readContract({
        address: MARKET_ADDRESS,
        abi,
        functionName: "markets",
        args: [BigInt(id)],
      }),
    ),
  )) as MarketTuple[];

  return rows.map((t, i) => ({
    id: ids[i],
    opener: t[0],
    closesAt: Number(t[1]),
    outcome: Number(t[2]) as Outcome,
    longPool: t[3],
    shortPool: t[4],
    fee: t[5],
  }));
}

/** Format 6-decimal USDC units as a dollar string (integer math, no float loss). */
export function usd(units: bigint): string {
  const MILLION = BigInt(1_000_000);
  const neg = units < BigInt(0) ? "-" : "";
  const abs = units < BigInt(0) ? -units : units;
  const whole = abs / MILLION;
  const cents = (abs % MILLION).toString().padStart(6, "0").slice(0, 2);
  return `${neg}${whole.toLocaleString("en-US")}.${cents}`;
}
