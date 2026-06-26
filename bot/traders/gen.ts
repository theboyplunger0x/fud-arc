// Generate N self-custodial trader wallets for synthetic-but-REAL on-chain betting.
// Keys land in wallets.json (gitignored, mode 600). Fund the printed addresses with
// Arc USDC, then run trade.ts. Usage: npx tsx traders/gen.ts [count] [--force]
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "wallets.json");
const N = Number(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : process.env.TRADER_COUNT ?? 5);
const force = process.argv.includes("--force");

if (existsSync(OUT) && !force) {
  console.error("wallets.json already exists — refusing to overwrite keys. Pass --force to regenerate.");
  process.exit(1);
}

const NAMES = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
const wallets = Array.from({ length: N }, (_, i) => {
  const privateKey = generatePrivateKey();
  return { name: `bot_${NAMES[i] ?? i}`, address: privateKeyToAccount(privateKey).address, privateKey };
});

mkdirSync(__dirname, { recursive: true });
writeFileSync(OUT, JSON.stringify(wallets, null, 2), { mode: 0o600 });

console.log(`\n✅ ${N} trader wallets → traders/wallets.json (gitignored, mode 600)\n`);
console.log("Fund each with Arc USDC (faucet.circle.com per address, or traders/fund.ts from the operator):\n");
for (const w of wallets) console.log(`  ${w.name.padEnd(12)} ${w.address}`);
console.log("");
