# FUD on Arc — Project Context & Handoff

> Single source of context for this repo. If you open VS Code here fresh, read this first.
> Last updated: 2026-06-18.

---

## 1. What this is

The **Arc/Lepton hackathon** build of FUD. Production FUD (a separate, private
repo) is a live-on-Base social prediction-markets
platform: users open LONG/SHORT P2P conviction markets on crypto tokens,
settled on-chain, resolved by GenLayer. This repo is the **Arc-native, agent-driven**
version built for the hackathon.

**One-liner:** an agent (Telegram + X bot) turns social trade calls into P2P
USDC conviction markets on Arc, resolved by GenLayer, where the **opener
(creator) earns a cut**.

> FUD is live on Base with P2P conviction markets. On Arc we build the
> stablecoin-native, agent-driven version — and pay the creators who bring the calls.

---

## 2. The hackathon (Lepton Agents, on Arc, run by Canteen × Circle)

- **Theme:** nanopayments / autonomous paying agents / creator-publisher
  monetization. NOT a prediction-markets theme — framed around "decentralizing
  the Liberapay problem" (recurring payments stuck on Stripe/PayPal).
- **RFBs** (non-binding prompts): #1 Autonomous Paying Agents, #2 Selling Agent
  Services via Nanopayments, #3 Agent-to-Agent Nanopayments, #4 Streaming
  Payments, #5 Nanopayment Infra/Tooling, **#6 Creator & Publisher Monetization**.
  → FUD-on-Arc hits **#1 + #6**.
- **Judging:** real product + real problem + traction + **work done IN the
  2-week window** (do NOT squash commits — they want to see the history).
- **Deliverables:** 2–3 min video walkthrough, working URL, team/socials,
  **open-source/forkable repo**, submit via **ARC-CLI**.
- **Deadline:** ~2026-06-29 midnight. Live sessions 2026-06-19 and 2026-06-26.
- **ARC-CLI** (Canteen, tracks progress for judges):
  `uv tool install git+https://github.com/the-canteen-dev/ARC-cli.git`,
  then `arc-canteen login` / `context sync` / `update product` / `update traction`.
  (Requires `uv` — not yet installed locally.)

---

## 3. Product direction (LOCKED)

"**FUD Calls Agent on Arc**" — NOT FUD FX as a core product, NOT Polymarket-style
shares, NOT a new payout curve. The bot turns a social call into a P2P USDC
market; the opener/creator earns a cut.

**3 pieces already exist in production FUD** (so the hackathon build is narrow):
- The **bot** (Telegram LIVE, X live-but-dormant) that converts a structured
  call `@fudmarkets open long $100 on <CA> 1h` into an on-chain market. Parser
  is **regex, CA-only** (rejects tickers by design); Claude only fires on a
  complete intent to create + reply. Lazy P2P via Privy autosign.
- **GenLayer** resolver — real, load-bearing for memecoins (Python Intelligent
  Contract, validator consensus, 3% tolerance). It's the PARTNER's tech; don't
  pitch it as FUD-owned, pitch the integration.
- **Opener fee** = creator monetization, ALREADY on-chain in prod:
  `pct = min(20%, 0.05·√(loserPool/25))`, `opener$ = loserFee·pct`, table
  `opener_rewards`. On Arc (separate deploy) we can crank this cut freely
  without touching Base economics.

**2-week build delta:**
1. ✅ USDC-native lazy-escrow on Arc (this repo, step 1 = minimal escrow).
2. Lazy/signature-matched P2P (port LazyBet / createAndPlaceBet from Base).
3. GenLayer → Arc settlement bridge (resolve off-chain → settle USDC on Arc).
4. Bot (TG + X) pointed at Arc.
5. Crank creator cut.
6. Demo (TG live + interactive; X pre-staged due to 5-min poll), working URL, FE.

---

## 4. Multi-asset ("make it big") — findings

Goal: don't stay token-only; add FX + (later) stocks alongside crypto = "una bomba".

- **Price source = pull oracle, NOT StableFX.** StableFX is a permissioned
  (KYB/AML institutions-only) RFQ **swap** rail, only prices USDC↔EURC, no
  read-only price endpoint → useless as a settlement feed. RULED OUT for the core.
- **VERIFIED 2026-06-19 on Arc testnet: Pyth IS deployed** at
  `0x2880aB155794e7179c9eE2e38200202908C17B43` — `getPriceUnsafe` reads EUR/USD +
  BTC/USD on-chain with no push/fee/VAA needed. **FX markets settle by reading
  Pyth on-chain on Arc** (Hermes off-chain is only the live UI ticker / fallback).
  Stork is also deployed (`0xacC0a0cF…`) but has **no FX feed populated** (EUR/USD
  reverts NotFound) + 5-6d-stale crypto → not usable. RedStone not on Arc.
  **Decision: Pyth, not Stork.**
- **Backend is close:** prod FUD already settles synthetic MULTI markets (no CA,
  Pyth/Coinbase canonical) for BTC/ETH/SOL. Adding EUR/USD or AAPL ≈ whitelist
  rows, near-zero oracle changes. The creation engine already accepts
  symbol-without-CA; **CA-only is just a bot-parser guard**, and its rationale
  (ticker ambiguity) does NOT apply to canonicals (one true feed). Fix = a
  curated canonical-symbol whitelist the parser recognizes.
- **Market hours = the landmine.** Crypto 24/7. FX 24/5 (weekend gap — trivial:
  Friday close holds, TradFi convention). Stocks 6.5h/day + holidays +
  Pyth's 24/7 "Indices" are proprietary (not official close → disputes) +
  licensing grey zone → **stocks = roadmap, not hackathon.**
- **Scope call:** crypto + FX now (FX fits Arc/Circle perfectly, no StableFX
  needed), stocks/metals = vision slide. Demo = crypto on Arc + 1 FX pair (EUR/USD).
- **Arc USDC footgun:** native gas USDC = 18 decimals, ERC-20 USDC
  (`0x3600…0000`) = 6 decimals — same underlying balance, two interfaces.
  All escrow math uses the 6-dp ERC-20 interface.

---

## 5. Partner & scope decision

The hackathon partner narrative is **GenLayer** — a real, load-bearing integration
(it resolves FUD's markets) — plus **native USDC on Arc/Circle**. FUD's P2P model
needs no external swap rail or liquidity provider: the counterparty *is* the
liquidity, and settlement price comes from a **pull oracle** (see §4), not a swap
venue. So the core carries **no third-party dependency** beyond GenLayer + Arc.

---

## 6. Build status — Step 1 (minimal escrow) DONE + DEPLOYED + SMOKE-TESTED

`src/FudArcMarket.sol` — two-sided P2P market escrow:
open → bet LONG/SHORT → operator resolves → winners claim (stake + pro-rata of
net losing pool) → opener claims creator cut. Fee 10% of losing pool, opener cut
20% of fee. Handles draw + one-sided (full refund). **27/27 unit tests pass**
(incl. constructor zero-address guard and opener-straddle security regression).
`forge fmt`-clean; runtime 4,742 B. Independent security review: **0 critical /
0 high**; medium/low pre-mainnet hardening items are documented, not blockers
for the testnet hackathon demo.

**Deployed to Arc testnet 2026-06-16 (current):**
```
FudArcMarket:  0x57352a7983E57De691fcEa5d7544CF6a398c0bf1   (current — matches repo HEAD)
Explorer:      https://testnet.arcscan.app/address/0x57352a7983E57De691fcEa5d7544CF6a398c0bf1
operator/treasury: deployer (single-key for now)
superseded:    0xA2C7060Ef31f17Fa359D498Daf5347fDa15F763a  (pre-fmt / pre-constructor-guard — dead)
               0x243099Cd8ebD0b0710D089666C28f133D9B4e861  (pre-review PUSH build — dead)
```
Smoke-tested on-chain (full loop: approve → open → bet → resolve → claim →
creator, contract drains to 0). The Telegram→Arc bot path (FUDmarkets `arc-demo`
branch) drives this contract via `arcMarketService`.

> ✅ **ON-CHAIN == REPO (reconciled 2026-06-16).** Latest source — pull-based
> payouts (`claimTreasury()`/`claimCreator()`), constructor + setter zero-address
> guards, `forge fmt`-clean, integer pro-rata dust accepted as negligible (single-
> winner markets, incl. the demo, distribute exactly) — was **redeployed** to
> `0x57352a7983E57De691fcEa5d7544CF6a398c0bf1` and verified fresh on-chain
> (`nextMarketId == 1`, `treasuryClaimable == 0`, balance 0 at deploy; the live contract has
> **since been seeded with demo markets** for the FE, so today it holds a few open/resolved
> markets — `nextMarketId > 1`). Prior
> deploys `0xA2C7…` and `0x2430…` are **superseded — dead, do not use.**

---

## 7. Arc testnet reference

```
RPC:        https://rpc.testnet.arc.network
Chain ID:   5042002
Gas token:  USDC (native 18-dp; ERC-20 interface 6-dp at 0x3600000000000000000000000000000000000000)
Explorer:   https://testnet.arcscan.app
Faucet:     https://faucet.circle.com
EURC (testnet): 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a (6-dp)
Stork oracle (testnet): 0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62
```

Deployer key lives in `.env` (gitignored, throwaway testnet key). Fund via faucet.

## 8. Dev commands
```bash
forge build
forge test -vvv
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast   # needs .env funded
```

## 9. Next steps
- [ ] Record the 2–3 min walkthrough from `docs/demo-script.md`.
- [ ] Deploy / confirm the frontend working URL and add it to `docs/submission-checklist.md`.
- [ ] Install `uv` + ARC-CLI; start posting progress updates to judges.
- [ ] Submit early, then update with the final video/frontend URL.
- [ ] Post-hackathon / pre-mainnet: snapshot treasury per market, move ownership to two-step, port lazy/signature P2P, and wire the GenLayer relay as production settlement.

## 10. Notes
Internal brainstorm / strategy transcripts are intentionally kept **out of this
repo** (local only). The source, tests, deploy script, and this file are the
canonical context for the Arc build.
