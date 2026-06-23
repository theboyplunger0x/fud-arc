import { type NextRequest } from "next/server";
import { getBufiClient, quotePair, BufiNotConfigured } from "@/lib/bufiQuote";

// Node runtime — the SDK is a Node/fetch client; the API key stays server-side.
// POST { amount, recipient?, direction? } → live quotes for every regional stablecoin.
//   direction "fund" (default): X → USDC   ·   "cashout": USDC → X
export const runtime = "nodejs";

// Verified to route to USDC on Arc testnet (JPYC has no venue in the sandbox).
const BOARD_CURRENCIES = ["EURC", "MXNB", "QCAD", "AUDF"] as const;
const DEAD = "0x000000000000000000000000000000000000dEaD" as const;
const MAX_AMOUNT = 1e12;

interface BoardRow {
  cur: string;
  ok: boolean;
  buyAmount?: string;
  rate?: string;
}

// Indicative quotes change slowly + many clients ask for the same amount/direction
// (e.g. the rates fetch at 100). Cache per warm serverless instance to spare the
// upstream BUFI quota. Recipient is excluded from the key — pricing is recipient-agnostic.
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 100;
const cache = new Map<string, { at: number; quotes: BoardRow[] }>();

export async function POST(req: NextRequest) {
  let body: { amount?: string; recipient?: string; direction?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const amount = body.amount;
  const n = Number(amount);
  if (!amount || !Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }
  const cashout = body.direction === "cashout";

  const cacheKey = `${cashout ? "cashout" : "fund"}:${amount}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Response.json({ quotes: hit.quotes });
  }

  // Quotes are recipient-agnostic in value — fall back to a burn address for pricing.
  const recipient = (body.recipient && /^0x[a-fA-F0-9]{40}$/.test(body.recipient)
    ? body.recipient
    : DEAD) as `0x${string}`;

  let fx;
  try {
    fx = getBufiClient();
  } catch (e) {
    if (e instanceof BufiNotConfigured) {
      return Response.json({ error: "StableFX not configured" }, { status: 500 });
    }
    return Response.json({ error: "StableFX unavailable" }, { status: 502 });
  }

  const settled = await Promise.allSettled(
    BOARD_CURRENCIES.map((cur) =>
      cashout
        ? quotePair(fx, "USDC", cur, String(amount), recipient)
        : quotePair(fx, cur, "USDC", String(amount), recipient),
    ),
  );
  const quotes: BoardRow[] = settled.map((r, i) => {
    const cur = BOARD_CURRENCIES[i];
    if (r.status === "fulfilled") {
      return { cur, ok: true, buyAmount: r.value.buyAmount, rate: r.value.rate };
    }
    return { cur, ok: false };
  });

  if (quotes.some((q) => q.ok)) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(cacheKey, { at: Date.now(), quotes });
  }

  return Response.json({ quotes });
}
