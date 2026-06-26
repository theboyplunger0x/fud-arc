// Asset registry + Pyth price lookup. pythIds MUST match the FE (web/src/lib/marketMeta.ts).
export interface AssetDef {
  key: string; // command symbol, e.g. "BTC", "EURUSD"
  ticker: string; // display, e.g. "BTC", "EUR/USD"
  kind: "crypto" | "fx";
  pythId: string; // hex, no 0x
  aliases?: string[];
  invertPyth?: boolean; // true when the product pair is the inverse of the Pyth feed.
}

export const ASSETS: AssetDef[] = [
  { key: "BTC", ticker: "BTC", kind: "crypto", pythId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
  { key: "ETH", ticker: "ETH", kind: "crypto", pythId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
  { key: "SOL", ticker: "SOL", kind: "crypto", pythId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d" },
  { key: "EURUSD", ticker: "EUR/USD", kind: "fx", pythId: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b" },
  { key: "GBPUSD", ticker: "GBP/USD", kind: "fx", pythId: "84c2dde9633d93d1bcad84e7dc41c9d56578b7ec52fabedc1f335d673df0a7c1" },
  {
    key: "JPYUSD",
    ticker: "JPY/USD",
    kind: "fx",
    pythId: "ef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52",
    aliases: ["USDJPY"],
    invertPyth: true,
  },
  { key: "AUDUSD", ticker: "AUD/USD", kind: "fx", pythId: "67a6f93030420c1c9e3fe37c1ab6b77966af82f995944a9fefce357a22854a80" },
];

const norm = (s: string) => s.trim().toUpperCase().replace(/[/\-\s]/g, "");

export function resolveAsset(input: string): AssetDef | null {
  const n = norm(input);
  return ASSETS.find((a) => norm(a.key) === n || norm(a.ticker) === n || (a.aliases ?? []).some((alias) => norm(alias) === n)) ?? null;
}

export const ASSET_LIST = ASSETS.map((a) => a.key).join(", ");

/** Latest Pyth price via Hermes (off-chain). Returns null on any failure. */
export async function pythPrice(pythId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${pythId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { parsed?: { price: { price: string; expo: number; publish_time?: number } }[] };
    const p = data.parsed?.[0]?.price;
    if (!p) return null;
    // Reject stale prices (Hermes returning a cached value) — matters for resolution.
    if (typeof p.publish_time === "number" && Date.now() / 1000 - p.publish_time > 120) return null;
    return Number(p.price) * 10 ** p.expo;
  } catch {
    return null;
  }
}

export function quotePrice(raw: number, invertPyth?: boolean): number {
  return invertPyth && raw > 0 ? 1 / raw : raw;
}

export async function assetPrice(asset: AssetDef): Promise<number | null> {
  const raw = await pythPrice(asset.pythId);
  return raw == null ? null : quotePrice(raw, asset.invertPyth);
}

export function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(5);
}
