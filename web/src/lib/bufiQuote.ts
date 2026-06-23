import { BufiFx } from "@bufinance/fx";

// Shared StableFX (BUFI) quote helper. Used server-side only — the API key never
// reaches the browser. The single (/api/fx-quote) and board (/api/fx-board) routes
// both build on this so the BUFI setup lives in one place.

const TESTNET_URL = "https://bu-pasillo.tomas-cordero-esp.workers.dev";
const ARC_CHAIN_ID = 5042002;

export interface UsdcQuote {
  buyAmount: string;
  rate: string;
  fee: unknown;
  etaSeconds: number;
  venue: string;
}

export class BufiNotConfigured extends Error {
  constructor() {
    super("StableFX not configured");
    this.name = "BufiNotConfigured";
  }
}

export function getBufiClient(): BufiFx {
  const apiKey = process.env.BUFI_API_KEY;
  if (!apiKey) throw new BufiNotConfigured();
  return new BufiFx({ apiKey, baseUrl: TESTNET_URL });
}

// Quote selling `sellAmount` of `sell` → `buy` on Arc. Throws on no-route / error.
export async function quotePair(
  fx: BufiFx,
  sell: string,
  buy: string,
  sellAmount: string,
  recipient: `0x${string}`,
): Promise<UsdcQuote> {
  const res = await fx.quoteIntent({
    chainId: ARC_CHAIN_ID,
    sell,
    buy,
    sellAmount: String(sellAmount),
    recipient,
    taker: recipient,
  });
  const w = res.winner;
  if (!w) throw new Error("No route for this pair");
  return {
    buyAmount: w.buyAmountExpected,
    rate: w.effectiveRate,
    fee: w.protocolFee,
    etaSeconds: w.estimatedSettlementSeconds,
    venue: w.venue,
  };
}

// Convenience: quote `sell` → USDC (the funding direction).
export function quoteToUsdc(
  fx: BufiFx,
  sell: string,
  sellAmount: string,
  recipient: `0x${string}`,
): Promise<UsdcQuote> {
  return quotePair(fx, sell, "USDC", sellAmount, recipient);
}
