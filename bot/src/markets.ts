// Asset registry + Pyth price lookup. pythIds MUST match the FE (web/src/lib/marketMeta.ts).
export interface AssetDef {
  key: string; // command symbol, e.g. "BTC", "EURUSD"
  ticker: string; // display, e.g. "BTC", "EUR/USD"
  kind: "crypto" | "fx";
  pythId: string; // hex, no 0x
}

export const ASSETS: AssetDef[] = [
  { key: "BTC", ticker: "BTC", kind: "crypto", pythId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
  { key: "ETH", ticker: "ETH", kind: "crypto", pythId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
  { key: "SOL", ticker: "SOL", kind: "crypto", pythId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d" },
  { key: "EURUSD", ticker: "EUR/USD", kind: "fx", pythId: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b" },
];

const norm = (s: string) => s.trim().toUpperCase().replace(/[/\-\s]/g, "");

export function resolveAsset(input: string): AssetDef | null {
  const n = norm(input);
  return ASSETS.find((a) => norm(a.key) === n || norm(a.ticker) === n) ?? null;
}

export const ASSET_LIST = ASSETS.map((a) => a.key).join(", ");

/** Latest Pyth price via Hermes (off-chain). Returns null on any failure. */
export async function pythPrice(pythId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${pythId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { parsed?: { price: { price: string; expo: number } }[] };
    const p = data.parsed?.[0]?.price;
    if (!p) return null;
    return Number(p.price) * 10 ** p.expo;
  } catch {
    return null;
  }
}

export function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(5);
}
