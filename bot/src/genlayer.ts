/* eslint-disable @typescript-eslint/no-explicit-any */
// GenLayer price oracle — the bot's PRIMARY resolution source (Pyth is the fallback).
// At resolution the bot deploys a fresh Intelligent Contract (price_oracle_v2.py) on
// GenLayer, calls resolve() (the IC fetches Pyth + Coinbase + CoinGecko and
// returns an agreed price), reads back get_price(), and uses that to settle the
// Arc market. Ported from FUDmarkets backend/src/services/genLayerOracle.ts.
//
// studionet = free, leader-only (no GEN gas) — good enough to make "resolved by
// GenLayer" literally true. bradbury = real multi-validator consensus (needs GEN).
import { createAccount, createClient } from "genlayer-js";
import { studionet, testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pythPrice, quotePrice } from "./markets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORACLE_PATH = join(__dirname, "intelligent-oracles/price_oracle_v2.py");

export type GlNetwork = "studionet" | "bradbury";

export const GL_NETWORK: GlNetwork =
  process.env.ARC_GENLAYER_NETWORK === "bradbury" ? "bradbury" : "studionet";
export const GL_TIMEOUT_MS = Number(process.env.GENLAYER_TIMEOUT_MS ?? 75_000);

let _client: any = null;
let _clientNet: GlNetwork | null = null;

export function isGenLayerConfigured(): boolean {
  return !!process.env.GENLAYER_PRIVATE_KEY;
}

function getClient(network: GlNetwork): any {
  if (_client && _clientNet === network) return _client;
  const pk = process.env.GENLAYER_PRIVATE_KEY;
  if (!pk) throw new Error("GENLAYER_PRIVATE_KEY not set");
  const account = createAccount(`0x${pk.replace(/^0x/, "")}` as `0x${string}`);
  if (network === "studionet") {
    _client = createClient({
      chain: { ...studionet, rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } } },
      account,
    });
  } else {
    const rpcUrl = process.env.GENLAYER_RPC_URL ?? "https://rpc-bradbury.genlayer.com";
    _client = createClient({
      chain: { ...testnetBradbury, rpcUrls: { default: { http: [rpcUrl] } } },
      account,
    });
  }
  _clientNet = network;
  return _client;
}

export interface GenLayerPrice {
  price: number;
  confidence?: string;
  sources?: string[];
  oracleAddress: string;
  deployHash: string;
  resolveHash: string;
  network: GlNetwork;
}

/** Deploy + resolve a price oracle IC on GenLayer and read back the agreed price.
 *  Works with a Pyth feed alone (FX) or Pyth+Coinbase+CoinGecko (crypto majors). */
export async function getPriceFromGenLayer(
  symbol: string,
  pythFeedId: string,
  coinbasePair: string,
  coingeckoId: string,
  network: GlNetwork = GL_NETWORK,
): Promise<GenLayerPrice> {
  const client = getClient(network);
  const code = readFileSync(ORACLE_PATH, "utf-8");

  const deployHash = await client.deployContract({
    code,
    args: [symbol, pythFeedId ?? "", coinbasePair ?? "", coingeckoId ?? ""],
    leaderOnly: false,
  });
  const deployReceipt: any = await client.waitForTransactionReceipt({
    hash: deployHash, status: "ACCEPTED", retries: 30, interval: 2000,
  });
  const oracleAddress: string | undefined = deployReceipt?.data?.contract_address;
  if (!oracleAddress) throw new Error("GenLayer deploy failed — no contract address");
  if (deployReceipt?.consensus_data?.leader_receipt?.[0]?.execution_result === "ERROR") {
    throw new Error("GenLayer deploy execution error");
  }

  const resolveHash = await client.writeContract({
    address: oracleAddress, functionName: "resolve", args: [], leaderOnly: network === "studionet",
  });
  const resolveReceipt: any = await client.waitForTransactionReceipt({
    hash: resolveHash, status: "ACCEPTED", retries: 60, interval: 3000,
  });
  if (resolveReceipt?.consensus_data?.leader_receipt?.[0]?.execution_result === "ERROR") {
    throw new Error("GenLayer resolve execution error");
  }

  const result: any = await client.readContract({ address: oracleAddress, functionName: "get_price", args: [] });
  const price = Number(result?.price);
  if (!price || price <= 0) throw new Error(`GenLayer returned invalid price: ${result?.price}`);

  const sources = Array.isArray(result.sources)
    ? result.sources.map((s: unknown) => String(s))
    : typeof result.sources === "string" && result.sources.length > 0
      ? result.sources.split(",").map((s: string) => s.trim()).filter(Boolean)
      : undefined;

  return {
    price,
    confidence: typeof result.confidence === "string" ? result.confidence : undefined,
    sources,
    oracleAddress,
    deployHash,
    resolveHash,
    network,
  };
}

/** Reject the GenLayer call if it outlasts `ms` so the resolver can fall back to Pyth. */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "genlayer"): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms)),
  ]);
}

// Extra price sources for crypto majors (3-source agreement). FX pairs aren't on
// Coinbase/CoinGecko, so they resolve Pyth-only inside the IC. Keyed by display ticker.
const CRYPTO_SOURCES: Record<string, { coinbasePair: string; coingeckoId: string }> = {
  BTC: { coinbasePair: "BTC-USD", coingeckoId: "bitcoin" },
  ETH: { coinbasePair: "ETH-USD", coingeckoId: "ethereum" },
  SOL: { coinbasePair: "SOL-USD", coingeckoId: "solana" },
};

export interface ResolutionPrice {
  price: number;
  via: string; // "genlayer:studionet" | "genlayer:bradbury" | "pyth"
  oracleAddress?: string;
  resolveHash?: string;
  confidence?: string;
  sources?: string[];
}

/**
 * The resolver's price source: GenLayer first (so "resolved by GenLayer" is literal),
 * Pyth Hermes as the fallback so a GenLayer outage/timeout never bricks settlement.
 * Returns null only if BOTH fail (caller should retry next tick).
 */
export async function resolutionPrice(ticker: string, pythId: string, invertPyth = false): Promise<ResolutionPrice | null> {
  if (isGenLayerConfigured()) {
    try {
      const src = CRYPTO_SOURCES[ticker.toUpperCase()] ?? { coinbasePair: "", coingeckoId: "" };
      const gl = await withTimeout(
        getPriceFromGenLayer(ticker, pythId, src.coinbasePair, src.coingeckoId, GL_NETWORK),
        GL_TIMEOUT_MS,
      );
      const price = quotePrice(gl.price, invertPyth);
      console.log(`[genlayer] ${ticker} = ${price} via [${gl.sources ?? []}] conf=${gl.confidence} oracle=${gl.oracleAddress}`);
      return {
        price,
        via: `genlayer:${gl.network}`,
        oracleAddress: gl.oracleAddress,
        resolveHash: gl.resolveHash,
        confidence: gl.confidence,
        sources: gl.sources,
      };
    } catch (e) {
      console.warn(`[genlayer] ${ticker} failed → Pyth fallback:`, (e as Error)?.message);
    }
  }
  const p = await pythPrice(pythId);
  return p == null ? null : { price: quotePrice(p, invertPyth), via: "pyth" };
}
