/**
 * Demo paying client for the x402 paid-signals endpoint.
 *
 *   npx tsx web/scripts/pay-signals.ts
 *
 * Acts as a paying AI agent: it hits GET /api/agent/signals, receives a 402,
 * signs an EIP-3009 transferWithAuthorization for the BUYER wallet (gasless —
 * the facilitator broadcasts), retries with the PAYMENT-SIGNATURE header, and
 * prints the 200 body, the on-chain settle tx hash, and the Arcscan URL.
 *
 * BUYER_PK comes from web/.env.local (gitignored) — never hardcoded, never logged.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, http, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Arc testnet (kept local so this script has zero imports from the app).
const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  testnet: true,
});
const EXPLORER = "https://testnet.arcscan.app";
const X402_NETWORK = `eip155:${arcTestnet.id}`;
const ENDPOINT = process.env.SIGNALS_URL ?? "http://localhost:3005/api/agent/signals";

/** Minimal .env.local loader (only the keys we need; never logs values). */
function loadEnvLocal(): Record<string, string> {
  const path = resolve(__dirname, "..", ".env.local");
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    throw new Error(`Could not read ${path} — run from repo root with .env.local present`);
  }
  return out;
}

function normalizePk(pk: string): Hex {
  const p = pk.startsWith("0x") ? pk : `0x${pk}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(p)) throw new Error("Malformed BUYER_PK");
  return p as Hex;
}

async function main() {
  const env = loadEnvLocal();
  const buyerPk = normalizePk(env.BUYER_PK ?? process.env.BUYER_PK ?? "");

  const account = privateKeyToAccount(buyerPk);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);

  const client = new x402Client();
  registerExactEvmScheme(client, { signer, networks: [X402_NETWORK as `${string}:${string}`] });

  const fetchWithPay = wrapFetchWithPayment(globalThis.fetch, client);

  console.log(`[buyer] ${account.address}`);
  console.log(`[GET]   ${ENDPOINT}`);

  // 1) Unpaid probe (raw fetch) — show the real 402.
  const probe = await fetch(ENDPOINT);
  console.log(`\n--- unpaid probe -> HTTP ${probe.status} ---`);
  const challenge = probe.headers.get("payment-required") ?? probe.headers.get("www-authenticate");
  if (challenge) console.log("challenge header:", challenge.slice(0, 200));
  console.log("body:", (await probe.text()).slice(0, 400));

  // 2) Paid request — wrapFetchWithPayment handles the 402 -> sign -> retry.
  console.log(`\n--- paying & retrying ---`);
  const res = await fetchWithPay(ENDPOINT);
  console.log(`paid request -> HTTP ${res.status}`);

  const payResp = res.headers.get("payment-response");
  let txHash: string | undefined;
  let payer: string | undefined;
  if (payResp) {
    try {
      const decoded = decodePaymentResponseHeader(payResp);
      txHash = decoded.transaction;
      payer = decoded.payer;
    } catch {
      /* fall back to body */
    }
  }

  const bodyText = await res.text();
  console.log("\n--- 200 body ---");
  console.log(bodyText);

  let body: { settlement?: { txHash?: string; payer?: string; payTo?: string; amount?: string } } = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    /* non-JSON */
  }
  txHash = txHash ?? body.settlement?.txHash;
  payer = payer ?? body.settlement?.payer;

  if (res.status !== 200) {
    console.error(`\nFAILED: expected 200, got ${res.status}`);
    process.exit(1);
  }
  if (!txHash) {
    console.error("\nFAILED: 200 but no settlement tx hash — refusing to claim success.");
    process.exit(1);
  }

  console.log("\n=== SETTLEMENT ===");
  console.log("payer:  ", payer ?? body.settlement?.payer);
  console.log("payTo:  ", body.settlement?.payTo);
  console.log("amount: ", body.settlement?.amount, "(atomic 6-dec USDC)");
  console.log("txHash: ", txHash);
  console.log("arcscan:", `${EXPLORER}/tx/${txHash}`);

  // 3) Independent on-chain confirmation.
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });
  console.log(`\non-chain receipt status: ${receipt.status} (block ${receipt.blockNumber})`);
  if (receipt.status !== "success") {
    console.error("FAILED: tx did not succeed on-chain.");
    process.exit(1);
  }
  console.log("\nOK: real on-chain USDC settlement confirmed.");
}

main().catch((e) => {
  console.error("error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
