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
  invertPyth?: boolean; // true when the displayed pair is the inverse of the Pyth feed.
  anchor?: number; // entry/anchor price at open (from the bot)
  caller?: string; // social: the handle that made the call
  call?: string; // social: the call's thesis / take
  takes?: { user: string; text: string; side: "long" | "short" }[]; // social: participants' takes
}

// Pyth feed ids (hex, no 0x).
const PYTH = {
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  EURUSD: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
} as const;

// Real markets opened on Arc (operator-funded escrow tracking a real Pyth feed).
// Honest labels only — ticker/side/timeframe/anchor are real (anchor = Pyth spot
// at open). NO invented social: real calls come from the bot's /arc/markets-meta
// (the handle that actually opened the market). The synthetic demo markets (#1-4)
// and all curated taglines were removed — everything shown here is real.
const REAL_SEED: Record<number, MarketMeta> = {
  7: { ticker: "EUR/USD", kind: "fx", side: "long", timeframe: "24h", pythId: PYTH.EURUSD, anchor: 1.1361 },
  6: { ticker: "ETH", kind: "crypto", side: "short", timeframe: "7d", pythId: PYTH.ETH, anchor: 1607 },
  5: { ticker: "BTC", kind: "crypto", side: "long", timeframe: "24h", pythId: PYTH.BTC, anchor: 60666 },
};

export const SEED_META: Record<number, MarketMeta> = { ...REAL_SEED };

const META_URL = process.env.NEXT_PUBLIC_ARC_META_URL;

interface RemoteMeta {
  ticker: string;
  kind: "crypto" | "fx";
  side: "long" | "short";
  timeframe: string;
  anchor: number;
  pythId: string | null;
  invertPyth?: boolean;
  caller?: string;
  call?: string;
  takes?: { user: string; text: string; side: "long" | "short" }[];
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
        invertPyth: m.invertPyth,
        anchor: m.anchor,
        caller: m.caller,
        call: m.call,
        takes: m.takes,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function submitRemoteTake(input: {
  marketId: number;
  side: "long" | "short";
  text: string;
  user?: string;
  address?: string;
}): Promise<boolean> {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!META_URL || !text) return false;
  try {
    const res = await fetch(`${META_URL.replace(/\/$/, "")}/arc/takes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Distinct, non-null Pyth feed ids in a meta map (for batch price polling). */
export function pythIdsOf(meta: Record<number, MarketMeta>): string[] {
  return [...new Set(Object.values(meta).map((m) => m.pythId).filter((x): x is string => !!x))];
}
