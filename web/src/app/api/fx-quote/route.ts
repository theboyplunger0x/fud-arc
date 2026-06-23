import { type NextRequest } from "next/server";
import { getBufiClient, quoteToUsdc, BufiNotConfigured } from "@/lib/bufiQuote";

// Node runtime — the SDK is a Node/fetch client; the API key stays server-side
// (never shipped to the browser). The FE POSTs { sell, sellAmount, recipient }.
export const runtime = "nodejs";

// Allowlisted sell currencies (the funding stablecoins) — never pass arbitrary
// user input straight to the upstream SDK.
const ALLOWED_SELL = new Set(["EURC", "MXNB", "QCAD", "AUDF"]);
const MAX_AMOUNT = 1e12;

export async function POST(req: NextRequest) {
  let body: { sell?: string; sellAmount?: string; recipient?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const { sell, sellAmount, recipient } = body;
  if (!sell || !sellAmount || !recipient) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }
  if (!ALLOWED_SELL.has(sell)) {
    return Response.json({ error: "Unsupported currency" }, { status: 400 });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    return Response.json({ error: "Invalid recipient" }, { status: 400 });
  }
  const n = Number(sellAmount);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  try {
    const fx = getBufiClient();
    const quote = await quoteToUsdc(fx, sell, String(sellAmount), recipient as `0x${string}`);
    return Response.json(quote);
  } catch (e: unknown) {
    if (e instanceof BufiNotConfigured) {
      return Response.json({ error: "StableFX not configured" }, { status: 500 });
    }
    // Don't forward upstream SDK error text in production (could leak internals).
    const msg = process.env.NODE_ENV === "development" && e instanceof Error ? e.message : "Quote unavailable";
    return Response.json({ error: msg }, { status: 502 });
  }
}
