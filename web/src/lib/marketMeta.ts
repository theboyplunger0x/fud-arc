// Off-chain identity for each on-chain market: which ASSET it is + the opener's
// side. The Arc contract is asset-agnostic, so this mapping (assigned by the bot
// when it opens a market) is the ONLY place a market is tied to a ticker. The
// live + anchor PRICES come from Pyth (see pyth.ts) via pythId.
//
// Two sources, merged: SEED_META (placeholder so the design is visible today) and
// the bot's /arc/markets-meta endpoint (real data for bot-opened markets, which
// overrides the seed). The endpoint base lives in NEXT_PUBLIC_ARC_META_URL.

export interface MarketMeta {
  ticker: string; // display ticker, e.g. "BTC" / "EUR/USD"
  kind: "crypto" | "fx"; // drives the asset pill styling
  side: "long" | "short"; // opener's side
  timeframe: string; // e.g. "15m" / "4H" / "7D" (from the bot)
  pythId: string | null; // Pyth feed id for the live price (hex, no 0x) — null for long-tail tokens
  anchor?: number; // entry/anchor price at open (from the bot)
}

// Pyth feed ids (hex, no 0x).
const PYTH = {
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  EURUSD: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
} as const;

// Placeholder example data so the card design is visible in LOCAL PREVIEW only.
// OFF by default → honest in prod: the synthetic on-chain markets (#1-4, opened
// operator-vs-operator as escrow demos) are NOT real assets, so labeling them
// would mislead. Real markets are labeled solely by the bot's /arc/markets-meta
// endpoint. Enable locally with NEXT_PUBLIC_DEMO_SEED=1 to preview the design.
const DEMO_SEED: Record<number, MarketMeta> = {
  4: { ticker: "EUR/USD", kind: "fx", side: "long", timeframe: "1w", pythId: PYTH.EURUSD, anchor: 1.145 },
  3: { ticker: "BTC", kind: "crypto", side: "long", timeframe: "1d", pythId: PYTH.BTC, anchor: 62000 },
  2: { ticker: "ETH", kind: "crypto", side: "long", timeframe: "4h", pythId: PYTH.ETH, anchor: 2400 },
  1: { ticker: "SOL", kind: "crypto", side: "short", timeframe: "1d", pythId: PYTH.SOL, anchor: 150 },
};

export const SEED_META: Record<number, MarketMeta> =
  process.env.NEXT_PUBLIC_DEMO_SEED === "1" ? DEMO_SEED : {};

const META_URL = process.env.NEXT_PUBLIC_ARC_META_URL;

interface RemoteMeta {
  ticker: string;
  kind: "crypto" | "fx";
  side: "long" | "short";
  timeframe: string;
  anchor: number;
  pythId: string | null;
}

/**
 * Fetch real market identity from the bot's /arc/markets-meta endpoint. Returns an
 * empty object when no URL is configured or the request fails, so the caller keeps
 * the seed (graceful — the bot may be offline outside a live demo).
 */
export async function fetchRemoteMeta(): Promise<Record<number, MarketMeta>> {
  if (!META_URL) return {};
  try {
    const res = await fetch(`${META_URL.replace(/\/$/, "")}/arc/markets-meta`);
    if (!res.ok) return {};
    const data = (await res.json()) as { markets?: Record<string, RemoteMeta> };
    const out: Record<number, MarketMeta> = {};
    for (const [id, m] of Object.entries(data.markets ?? {})) {
      out[Number(id)] = {
        ticker: m.ticker,
        kind: m.kind,
        side: m.side,
        timeframe: m.timeframe,
        pythId: m.pythId,
        anchor: m.anchor,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Distinct, non-null Pyth feed ids in a meta map (for batch price polling). */
export function pythIdsOf(meta: Record<number, MarketMeta>): string[] {
  return [...new Set(Object.values(meta).map((m) => m.pythId).filter((x): x is string => !!x))];
}
