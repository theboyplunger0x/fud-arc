/**
 * x402 payment gate — ISOLATED bonus feature.
 *
 * Builds an in-process "exact"-scheme x402 stack (gasless EIP-3009) bound to a
 * viem wallet on Arc testnet, and exposes a small `gate` API for a single route:
 *   - issue a 402 challenge when no/invalid payment is present
 *   - verify a presented X-PAYMENT header
 *   - settle it on-chain (a real payer -> payTo USDC transfer broadcast by the
 *     facilitator wallet, which pays gas in USDC)
 *
 * This module imports NOTHING from the core bot/board/betService/resolver. It
 * reuses only `arcTestnet`, `USDC_ADDRESS` from arc.ts (read-only constants).
 *
 * Keys come exclusively from process.env (loaded from the gitignored .env.local);
 * they are never hardcoded and never logged.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import type {
  FacilitatorClient,
  HTTPAdapter,
  HTTPProcessResult,
  RouteConfig,
} from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { registerExactEvmScheme as registerFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { registerExactEvmScheme as registerServerScheme } from "@x402/evm/exact/server";
import { toFacilitatorEvmSigner } from "@x402/evm";

import { arcTestnet, USDC_ADDRESS } from "./arc";

// --- Network + asset constants ------------------------------------------------

/** x402 CAIP-2 network id for Arc testnet (chainId 5042002). */
const X402_NETWORK = `eip155:${arcTestnet.id}` as const;

/**
 * Arc USDC is a Circle FiatTokenV2_2. Its on-chain `eip712Domain()` (EIP-5267)
 * reverts, so the EIP-712 domain MUST be supplied explicitly. Verified on-chain:
 * name()="USDC" (NOT "USD Coin"), version()="2"; the resulting domain separator
 * equals the token's DOMAIN_SEPARATOR(). The exact scheme reads these from
 * `requirements.extra` and throws if absent — so we always pass them.
 */
const USDC_EIP712 = { name: "USDC", version: "2" } as const;

/** Default price: 1000 atomic units = 0.001 USDC (6-decimal). */
const DEFAULT_PRICE_ATOMIC = "1000";

// --- Env-sourced config (never logged) ---------------------------------------

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`x402-gate: missing required env var ${name}`);
  }
  return v.trim();
}

function normalizePk(pk: string): Hex {
  const p = pk.startsWith("0x") ? pk : `0x${pk}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(p)) {
    // Never include the value in the error — only its length, for debugging.
    throw new Error(`x402-gate: malformed private key (len=${p.length})`);
  }
  return p as Hex;
}

// --- Lazy singletons ----------------------------------------------------------

interface Gate {
  /** payTo address advertised in the challenge and credited on settlement. */
  readonly payTo: `0x${string}`;
  /** Price in atomic (6-dec) USDC units. */
  readonly priceAtomic: string;
  /**
   * Process an incoming request. Returns either a 402 challenge (no/invalid
   * payment) or the verified payment material to settle after producing the body.
   */
  process(args: {
    method: string;
    url: string;
    path: string;
    paymentHeader?: string;
    userAgent?: string;
    accept?: string;
  }): Promise<HTTPProcessResult>;
  /**
   * Settle a verified payment on-chain. Returns the SettleResponse (with the real
   * tx hash in `.transaction`) plus the response headers x402 wants set.
   */
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<{ result: SettleResponse; headers: Record<string, string> }>;
}

let gatePromise: Promise<Gate> | null = null;

/** The route pattern the HTTP resource server matches against. */
const ROUTE_PATTERN = "GET /api/agent/signals";

async function buildGate(): Promise<Gate> {
  const facilitatorPk = normalizePk(requiredEnv("FACILITATOR_PK"));
  const payTo = getAddress(requiredEnv("PAY_TO"));
  const priceAtomic = (process.env.X402_SIGNALS_PRICE || DEFAULT_PRICE_ATOMIC).trim();
  if (!/^[0-9]+$/.test(priceAtomic) || priceAtomic === "0") {
    throw new Error("x402-gate: X402_SIGNALS_PRICE must be a positive integer (atomic USDC units)");
  }

  const account = privateKeyToAccount(facilitatorPk);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(),
  });

  // Compose a single viem-backed FacilitatorEvmSigner (read + verify + write).
  // The x402 signer interface uses loose `Record<string, unknown>` for EIP-712
  // typed-data fields; viem wants the strict `TypedData` shape. The payloads are
  // structurally identical at runtime, so we cast at this single boundary.
  const facilitatorSigner = toFacilitatorEvmSigner({
    address: account.address,
    readContract: (args) => publicClient.readContract(args),
    verifyTypedData: (args) =>
      publicClient.verifyTypedData(args as Parameters<typeof publicClient.verifyTypedData>[0]),
    writeContract: (args) =>
      walletClient.writeContract({
        ...args,
        account,
        chain: arcTestnet,
      } as Parameters<typeof walletClient.writeContract>[0]),
    sendTransaction: (args) =>
      walletClient.sendTransaction({ ...args, account, chain: arcTestnet }),
    waitForTransactionReceipt: (args) => publicClient.waitForTransactionReceipt(args),
    getCode: (args) => publicClient.getCode(args),
  });

  // In-process facilitator: verifies signatures and broadcasts the settle tx.
  const facilitator = new x402Facilitator();
  registerFacilitatorScheme(facilitator, {
    signer: facilitatorSigner,
    networks: X402_NETWORK,
  });

  // The resource server expects a FacilitatorClient whose getSupported() returns
  // a Promise; x402Facilitator.getSupported() is synchronous. Wrap it so the
  // in-process facilitator satisfies the FacilitatorClient interface exactly.
  const facilitatorClient: FacilitatorClient = {
    verify: (payload: PaymentPayload, reqs: PaymentRequirements): Promise<VerifyResponse> =>
      facilitator.verify(payload, reqs),
    settle: (payload: PaymentPayload, reqs: PaymentRequirements): Promise<SettleResponse> =>
      facilitator.settle(payload, reqs),
    getSupported: (): Promise<SupportedResponse> =>
      Promise.resolve(facilitator.getSupported() as SupportedResponse),
  };

  const resourceServer = new x402ResourceServer(facilitatorClient);
  registerServerScheme(resourceServer, { networks: [X402_NETWORK] });

  const routeConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      network: X402_NETWORK,
      payTo,
      // Explicit AssetAmount — 5042002 is not in x402 DEFAULT_STABLECOINS, so a
      // "$..." Money string would throw in getDefaultAsset. extra carries the
      // hardcoded EIP-712 domain the exact scheme needs for EIP-3009.
      price: {
        asset: USDC_ADDRESS,
        amount: priceAtomic,
        extra: { ...USDC_EIP712 },
      },
      maxTimeoutSeconds: 120,
    },
    description: "fud-arc on-chain market signals (paid per read via x402)",
    mimeType: "application/json",
  };

  const httpServer = new x402HTTPResourceServer(resourceServer, {
    [ROUTE_PATTERN]: routeConfig,
  });
  await httpServer.initialize();

  return {
    payTo,
    priceAtomic,
    async process(args) {
      const adapter = makeAdapter(args);
      return httpServer.processHTTPRequest({
        adapter,
        path: args.path,
        method: args.method,
        paymentHeader: args.paymentHeader,
        routePattern: ROUTE_PATTERN,
      });
    },
    async settle(payload, requirements) {
      const settled = await httpServer.processSettlement(payload, requirements);
      if (!settled.success) {
        // Surface the real failure reason (+ tx hash if the broadcast reverted
        // on-chain, for Arcscan traceability); never optimistic-pass.
        throw new SettleFailedError(
          settled.errorReason ?? "settlement_failed",
          settled.errorMessage,
          settled.transaction,
        );
      }
      return { result: settled, headers: settled.headers };
    },
  };
}

/** Thrown when the on-chain settle does not succeed — the caller must 402, never fake 200. */
export class SettleFailedError extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail?: string,
    public readonly txHash?: string,
  ) {
    super(`x402 settlement failed: ${reason}`);
    this.name = "SettleFailedError";
  }
}

/** Get (and lazily build) the singleton gate. */
export function getGate(): Promise<Gate> {
  if (!gatePromise) {
    gatePromise = buildGate().catch((e) => {
      // Reset so a transient config error can be retried on the next request.
      gatePromise = null;
      throw e;
    });
  }
  return gatePromise;
}

// --- Minimal HTTPAdapter over a plain request snapshot ------------------------

function makeAdapter(args: {
  method: string;
  url: string;
  path: string;
  paymentHeader?: string;
  userAgent?: string;
  accept?: string;
}): HTTPAdapter {
  const headers: Record<string, string> = {};
  if (args.paymentHeader) {
    // x402 v2 carries the signed payment in PAYMENT-SIGNATURE; v1 used X-PAYMENT.
    // The server's extractPayment() reads "payment-signature" (case-insensitive),
    // so expose it under both for compatibility.
    headers["payment-signature"] = args.paymentHeader;
    headers["x-payment"] = args.paymentHeader;
  }
  if (args.userAgent) headers["user-agent"] = args.userAgent;
  if (args.accept) headers["accept"] = args.accept;
  return {
    getHeader: (name) => headers[name.toLowerCase()],
    getMethod: () => args.method,
    getPath: () => args.path,
    getUrl: () => args.url,
    getAcceptHeader: () => args.accept ?? "",
    getUserAgent: () => args.userAgent ?? "",
  };
}
