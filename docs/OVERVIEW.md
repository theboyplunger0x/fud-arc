# FUD on Arc — Technical & Product Overview

> An agent turns a social trade call into a P2P USDC conviction market on Arc — and the creator who made the call earns a cut.

## The idea

FUD is live on Base, making opinions liquid: people post trade **calls**, others take the other side, and the market settles. On Arc we built the **agentic, stablecoin-native** version.

A user posts a call in Telegram — a token contract address, or an FX pair like `EUR/USD` — and an autonomous agent opens a real **P2P conviction market** on Arc, escrowed in USDC. A counterparty backs the other side; at close it resolves on-chain; winners reclaim their stake plus a share of the losing pool net of a fee, and **the creator who made the call earns a cut of that fee** — fully on-chain, no platform middleman.

## How it maps to the RFBs

- **RFB #1 — Autonomous Paying Agents.** The agent creates markets and disburses payouts — winner settlements *and* creator cuts — autonomously, in USDC on Arc.
- **RFB #6 — Creator & Publisher Monetization.** Every market a creator opens earns them an on-chain cut. The alpha-caller monetizes their conviction directly.

## How it works (the loop)

1. **Call** — a user posts in Telegram: `long $5 on <CA> 15m`, or an FX pair `EUR/USD`.
2. **Market** — the agent opens a market on the `FudArcMarket` contract on Arc (`openMarket`), escrowing the opener's USDC stake. A counterparty backs the other side (`bet`). Both stakes sit in on-chain escrow.
3. **Resolve** — at close, the resolver reports the winning side (`resolve`). The bot now uses **GenLayer first**: it deploys an Intelligent Contract that reads live price sources (Pyth plus Coinbase/CoinGecko for crypto majors; Pyth-only for FX) and returns the resolution price. Pyth Hermes is the fallback so settlement does not stall if GenLayer times out.
4. **Pay out** — winners pull their stake + a pro-rata share of the losing pool, net of the protocol fee (`claim`); **the creator pulls their cut** (`claimCreator`). Payouts are pull-based, so a reverting recipient can never brick settlement.

The frontend reads markets **straight from the contract on Arc** — no backend in the middle — and renders them as live cards: pool odds, payout multipliers, countdown, status, a live Pyth price, and **the creator and the cut they earn**.

## Architecture — the asset-agnostic split

The key design choice: **the contract is asset-agnostic.** `FudArcMarket` stores only pools, close time, outcome, and the opener — never *which asset* a market is about. That keeps it minimal, decimal-agnostic (pure 6-decimal USDC integer math), and reusable for any market an oracle can resolve.

The asset identity (ticker, anchor price, timeframe) lives **off-chain** in the agent; the frontend merges it over the on-chain data through a read-only `/arc/markets-meta` endpoint. Live UI prices come from Pyth Hermes. Resolution is GenLayer-first with Pyth fallback.

```
 Telegram call ─▶ Agent ─▶ FudArcMarket  (USDC escrow on Arc)
                    │             │
                    │        resolve ◀── GenLayer first / Pyth fallback
                    │             │
                    │        claim · claimCreator  (pull-based USDC payouts)
                    ▼
            /arc/markets-meta ─┐
                               ▼
      Frontend ◀── reads the contract on-chain + merges meta + live Pyth price
```

## The economics (creator cut)

- **Protocol fee:** 10% of the losing pool (`FEE_BPS = 1000`).
- **Creator (opener) cut:** 20% of that fee = **2% of the losing pool** (`OPENER_CUT_BPS = 2000`), accrued pull-based in `creatorClaimable`.
- **Winners** split the losing pool net of the fee — equal pools resolve to a **1.9x** payout.

The frontend surfaces this directly: every card shows the creator, their side, and the cut they earn, plus an aggregate **"Creators earned $X"** read live from on-chain settlements.

## Why Arc

The whole loop is **USDC-native**: stakes, escrow, and every payout are USDC on Arc. No bridging, no wrapped assets, no separate gas token to reason about — the agent pays creators and winners in the stablecoin users already hold. Arc's USDC-as-gas plus native USDC make an autonomous-paying-agent economy frictionless. (Escrow math is in the 6-decimal USDC ERC-20 at `0x3600…0000`; the 18-decimal native USDC used for gas never touches the contract.)

## On-chain, verified

- **Contract:** `FudArcMarket` at `0x57352a7983E57De691fcEa5d7544CF6a398c0bf1` — Arc testnet, chainId `5042002`.
- **Oracles:** GenLayer is wired as the primary resolver on studionet, with live smoke tests for BTC (Pyth + Coinbase + CoinGecko) and EUR/USD (Pyth-only). Pyth is also **verified deployed on Arc** (`0x2880aB155794e7179c9eE2e38200202908C17B43`; `getPriceUnsafe` reads EUR/USD + BTC/USD on-chain, no push/fee/VAA), and remains the fallback price source.
- **Rigor:** 28 Foundry tests including a **fuzz conservation invariant** (Σ in = Σ out, nothing ever locked) over random amounts and outcomes; two code-review passes plus a Codex pass; pull-based payouts; resolve/claim guards; an FX settlement guard so the on-chain price always post-dates the market's open.

## What's real vs roadmap

**Real today:** on-chain USDC markets, escrow and pull-based payouts; the Telegram agent opening markets; GenLayer-first resolution with Pyth fallback; crypto + FX markets; the live, on-chain-reading dashboard with creator economics and winner claims surfaced.

**Roadmap (labeled, not claimed as done):** signature / lazy-match settlement (removing the single operator); pull-mode Pyth `updatePriceFeeds` for sub-second FX freshness; mainnet hardening (two-step ownership); on-chain bidding from the frontend (wallet-connect).

## Links

- **Live app:** https://fud-arc-hackaton.vercel.app
- **Contract / explorer:** https://testnet.arcscan.app/address/0x57352a7983E57De691fcEa5d7544CF6a398c0bf1
- **Repo:** https://github.com/theboyplunger0x/fud-arc
- **Demo walkthrough:** [docs/demo-script.md](./demo-script.md)
