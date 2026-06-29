/**
 * GET /api/agent/signals — a paid, machine-payable endpoint.
 *
 * Other AI agents pay a 0.001 USDC nanopayment (x402 "exact" scheme, gasless
 * EIP-3009, settled on Arc testnet) to read fud-arc's live on-chain market
 * signals. Proves "fud-arc as an autonomous agent that GETS PAID".
 *
 * - No  PAYMENT-SIGNATURE header  -> HTTP 402 + the x402 challenge.
 * - Valid PAYMENT-SIGNATURE header -> verify, build signals, settle on-chain,
 *   200 + the real settlement (txHash, payer, payTo, amount).
 *
 * ISOLATED: only reads `readMarkets()` + market metadata (read-only). No writes
 * to any core module. The on-chain transfer is performed by the facilitator wallet.
 */
import { type NextRequest } from "next/server";

import { readMarkets, usd, type Market } from "@/lib/arc";
import { SEED_META, fetchRemoteMeta, type MarketMeta } from "@/lib/marketMeta";
import { getGate, SettleFailedError } from "@/lib/x402-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- Lightweight per-IP rate limit (best-effort, in-memory) -------------------
// Bounds pre-payment on-chain verify work and facilitator gas exposure. EIP-3009
// nonces stop replays of the SAME payment, but a caller can mint fresh valid
// nanopayments; this caps the rate at which they force facilitator-funded
// settles. Per-instance only (fine for the demo) — not an edge limiter.
const RL_WINDOW_MS = 10_000;
const RL_MAX = 15;
const rlHits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (rlHits.size > 5000) {
    for (const [k, v] of rlHits) if (now >= v.resetAt) rlHits.delete(k);
  }
  const e = rlHits.get(ip);
  if (!e || now >= e.resetAt) {
    rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  e.count += 1;
  return e.count > RL_MAX;
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

interface Signal {
  marketId: number;
  ticker: string | null;
  kind: MarketMeta["kind"] | null;
  caller: string | null;
  call: string | null;
  takes: { user: string; text: string; side: "long" | "short" }[] | null;
  opener: string;
  closesAt: number;
  longPoolUsd: string;
  shortPoolUsd: string;
  impliedLongPct: number | null;
  impliedShortPct: number | null;
  longMultiplier: number | null;
  shortMultiplier: number | null;
}

/** Serialize OPEN markets (outcome 0) into agent-readable signals. */
function toSignals(markets: Market[], meta: Record<number, MarketMeta>): Signal[] {
  // Only sell markets that are genuinely OPEN: unresolved (outcome 0), still
  // before close, AND labeled (a known ticker). A closed-but-unresolved market
  // (outcome 0 in the gap before the resolver settles it) is NOT a live signal —
  // never charge for an expired or null "signal".
  const nowSec = Math.floor(Date.now() / 1000);
  const open = markets.filter((m) => m.outcome === 0 && m.closesAt > nowSec && meta[m.id]?.ticker);
  return open.map((m) => {
    const md = meta[m.id];
    const long = m.longPool;
    const short = m.shortPool;
    const total = long + short;
    // Implied probability from pool weight (integer math -> percent with 2 dp).
    const impliedLongPct =
      total > BigInt(0) ? Number((long * BigInt(10000)) / total) / 100 : null;
    const impliedShortPct = impliedLongPct === null ? null : Math.round((100 - impliedLongPct) * 100) / 100;
    // Payout multiplier = total / winning-side pool (what 1 unit returns). Null if side empty.
    const longMultiplier =
      long > BigInt(0) ? Number((total * BigInt(1000)) / long) / 1000 : null;
    const shortMultiplier =
      short > BigInt(0) ? Number((total * BigInt(1000)) / short) / 1000 : null;
    return {
      marketId: m.id,
      ticker: md?.ticker ?? null,
      kind: md?.kind ?? null,
      caller: md?.caller ?? null,
      call: md?.call ?? null,
      takes: md?.takes ?? null,
      opener: m.opener,
      closesAt: m.closesAt,
      longPoolUsd: usd(long),
      shortPoolUsd: usd(short),
      impliedLongPct,
      impliedShortPct,
      longMultiplier,
      shortMultiplier,
    };
  });
}

export async function GET(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "retry-after": "10" } });
  }

  let gate;
  try {
    gate = await getGate();
  } catch {
    // Misconfiguration (e.g. missing FACILITATOR_PK). Don't leak details.
    return Response.json({ error: "Payment gate unavailable" }, { status: 503 });
  }

  const url = new URL(req.url);
  // x402 v2 sends the signed payment in PAYMENT-SIGNATURE; v1 used X-PAYMENT.
  const paymentHeader =
    req.headers.get("payment-signature") ?? req.headers.get("x-payment") ?? undefined;

  const processed = await gate.process({
    method: "GET",
    url: req.url,
    path: url.pathname,
    paymentHeader,
    userAgent: req.headers.get("user-agent") ?? undefined,
    accept: req.headers.get("accept") ?? undefined,
  });

  // No payment / invalid payment -> emit the x402 402 challenge verbatim.
  if (processed.type === "payment-error") {
    const { status, headers, body } = processed.response;
    return Response.json(body ?? {}, { status, headers });
  }

  // Defensive: a GET on this route always requires payment, so the only other
  // expected branch is "payment-verified". Anything else is a config bug.
  if (processed.type !== "payment-verified") {
    return Response.json({ error: "Payment required" }, { status: 402 });
  }

  // Payment verified. Build the real signals payload.
  let signals: Signal[];
  try {
    const markets = await readMarkets();
    const remote = await fetchRemoteMeta();
    const meta = { ...SEED_META, ...remote };
    signals = toSignals(markets, meta);
  } catch {
    // We verified payment but could not read chain data. Do NOT settle — the
    // buyer keeps their funds (no transfer happens) and gets a 502.
    return Response.json({ error: "Signals unavailable" }, { status: 502 });
  }

  // Don't charge for an empty/degraded payload: if no LABELED signals are
  // available (e.g. metadata source down + no seed-labeled open markets), refuse
  // BEFORE settling so the buyer keeps their funds.
  if (signals.length === 0) {
    return Response.json({ error: "No signals available" }, { status: 503 });
  }

  // Settle on-chain: a real payer -> payTo USDC transfer broadcast by the
  // facilitator. If settlement fails we return 402, never a fake 200.
  try {
    const { result, headers } = await gate.settle(
      processed.paymentPayload,
      processed.paymentRequirements,
    );
    return Response.json(
      {
        signals,
        paid: true,
        settlement: {
          txHash: result.transaction,
          payer: result.payer,
          payTo: gate.payTo,
          amount: result.amount ?? gate.priceAtomic,
          network: result.network,
        },
      },
      { status: 200, headers },
    );
  } catch (e) {
    if (e instanceof SettleFailedError) {
      // Include the on-chain tx hash when the settle was broadcast but reverted,
      // so a failed settle stays traceable on Arcscan.
      return Response.json(
        { error: "Payment settlement failed", reason: e.reason, ...(e.txHash ? { txHash: e.txHash } : {}) },
        { status: 402 },
      );
    }
    return Response.json({ error: "Payment settlement failed", reason: "settlement_failed" }, { status: 402 });
  }
}
