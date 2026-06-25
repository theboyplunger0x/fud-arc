# FUD on Arc — 2–3 min demo script

> Walkthrough for the hackathon video. Goal: show a real agent turning a social call into a
> P2P USDC market on Arc, settled on-chain, paying the creator — RFB #1 + #6.

**Total target: ~2:30.** Keep it fast, terminal-and-product, no slides.

---

### 0:00 — Hook (15s)
> "Crypto runs on conviction — but conviction has no market. FUD is live on Base making opinions
> liquid. For Arc, we built the agentic, stablecoin-native version: an agent turns a Telegram call
> into a P2P USDC market, on-chain, and **pays the creator who made the call.**"

Show: the FUD wordmark / one line of positioning.

### 0:15 — The call → a market on Arc (45s)
Show: the Telegram chat. Type:
```
@fudmarkets open long $5 on <CA> 15m
```
The bot replies: **"LONG $5 on <TICKER> · 15m — Opened on Arc ✅ · on-chain market #N"** with a tx link.

> "No new UI, no new bot — this is our live FUD agent, pointed at Arc behind a flag. It opened a real
> market on-chain: the creator's side, and a matched counterparty, escrowed in USDC."

Cut to the Arc explorer (testnet.arcscan.app) on the tx → show `openMarket` + `bet` on `FudArcMarket`.

### 1:00 — The frontend, live from chain (30s)
Show: the web app (working URL). The new market appears in the list — **LIVE**, the pool bar, the
countdown.
> "The dashboard reads markets straight from the Arc contract — no backend in the middle. Here's the
> market we just opened, live."

Scroll to a resolved market: green **LONG won**, fee / creator cut visible.

### 1:30 — Settlement: GenLayer + USDC on Arc (40s)
> "At close, the outcome comes from **GenLayer**. The bot deploys a GenLayer Intelligent Contract
> that reads live price sources — Pyth plus Coinbase and CoinGecko for crypto majors, Pyth for FX —
> and uses that price to settle in USDC on Arc. If GenLayer times out, Pyth is the fallback so the
> market never stalls. Winners claim from escrow; the creator earns their cut."

Show: the bot's resolution log (`via genlayer:studionet`) and the explorer `resolve` + `claim` +
`claimCreator` txs. Do **not** say "GenLayer consensus" unless the bot is running on Bradbury.

### (optional) Multi-asset: FX through the same resolver path (20–30s)
> "It's not just tokens. Type an FX pair — `EUR/USD` — and the agent opens the same USDC market on Arc.
> At close, GenLayer resolves it with the FX Pyth feed; if GenLayer is unavailable, the bot falls
> back to Pyth directly. **Crypto and FX markets, settled in USDC on Arc.**"

Show: the bot opening an `EUR/USD` market, then the resolve log line `… via genlayer:studionet`
or, on fallback, `… via pyth`.

Presenter notes (so the claim survives scrutiny):
- FX updates at market cadence; for a visibly fast live tick, show **BTC/USD**. Frame FX as "resolved
  through GenLayer with a Pyth FX feed", NOT "real-time FX".
- Run in a **weekday / market-open** window — FX doesn't update on weekends.
- Have `cast code 0x2880aB155794e7179c9eE2e38200202908C17B43` ready: Pyth's *canonical* address
  (`0x4305FB…`) is NOT on Arc; Arc uses a per-chain deployment — pre-empt that objection.
- Roadmap (do NOT claim as done): Bradbury multi-validator consensus, persisted resolver proof badges
  in the frontend, and pull-mode `updatePriceFeeds` + Hermes VAA for sub-second freshness.

### 2:10 — Close (20s)
> "FUD proved P2P conviction markets on Base. On Arc we made them agentic and stablecoin-native: an
> autonomous agent that creates markets and pays creators — Autonomous Paying Agents and Creator
> Monetization, in one loop. Open-source, on Arc."

Show: the GitHub repo + the live URL on screen.

---

## Pre-record checklist
- [ ] Bot running with `ARC_OPERATOR_KEY` funded (Arc testnet USDC + gas).
- [ ] `GENLAYER_PRIVATE_KEY`, `ARC_GENLAYER_NETWORK=studionet`, and `GENLAYER_TIMEOUT_MS=75000` set on Railway.
- [ ] Pick a 15m timeframe so the open→bet window is comfortable and the market resolves within the demo.
- [ ] Frontend deployed (working URL) with a couple of seeded markets (one LIVE, one resolved) for the dashboard shot.
- [ ] Have the Arc explorer tab ready on the contract `0x57352a7983E57De691fcEa5d7544CF6a398c0bf1`.
- [ ] Have tx tabs ready for `openMarket`, `bet`, `resolve`, `claim`, and `claimCreator`.
- [ ] Run the final checklist in `docs/submission-checklist.md`.
