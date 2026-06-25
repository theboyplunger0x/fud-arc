import "dotenv/config";
import { resolutionPrice } from "../src/genlayer.js";

// Prove the bot's GenLayer-first resolution path works for a crypto major (3-source
// agreement) AND an FX pair (Pyth-only inside the IC). Run: npx tsx scripts/test_genlayer.ts
const CASES = [
  { ticker: "BTC", pythId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
  { ticker: "EUR/USD", pythId: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b" },
];

for (const c of CASES) {
  const t0 = Date.now();
  try {
    const r = await resolutionPrice(c.ticker, c.pythId);
    console.log(
      `\n✅ ${c.ticker}: ${r ? `${r.price} via ${r.via} conf=${r.confidence ?? "-"} sources=${JSON.stringify(r.sources ?? [])}` : "NULL"} (${Date.now() - t0}ms)`,
    );
    if (r?.oracleAddress) console.log(`   oracle=${r.oracleAddress} resolve=${r.resolveHash}`);
  } catch (e) {
    console.error(`\n❌ ${c.ticker}: ${(e as Error)?.message} (${Date.now() - t0}ms)`);
  }
}

process.exit(0);
