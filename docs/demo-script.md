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
> "At close, the outcome comes from **GenLayer** — the same decentralized validator-consensus oracle
> that resolves FUD in production — and settles in USDC on Arc. Winners claim their stake plus the
> losing pool; **the creator claims their cut**, all on-chain."

Show: the bot's resolution message ("resolved on Arc — LONG won · Resolved by GenLayer consensus")
and the explorer `resolve` + `claim` + `claimCreator` txs.

### 2:10 — Close (20s)
> "FUD proved P2P conviction markets on Base. On Arc we made them agentic and stablecoin-native: an
> autonomous agent that creates markets and pays creators — Autonomous Paying Agents and Creator
> Monetization, in one loop. Open-source, on Arc."

Show: the GitHub repo + the live URL on screen.

---

## Pre-record checklist
- [ ] Backend running with `ARC_DEMO_ENABLED=1` + `ARC_OPERATOR_KEY` funded (Arc testnet USDC + gas).
- [ ] (Optional) `GENLAYER_PRIVATE_KEY` set so resolution shows "via GenLayer"; else it falls back to DexScreener.
- [ ] Pick a 15m timeframe so the open→bet window is comfortable and the market resolves within the demo.
- [ ] Frontend deployed (working URL) with a couple of seeded markets (one LIVE, one resolved) for the dashboard shot.
- [ ] Have the Arc explorer tab ready on the contract `0x57352a7983E57De691fcEa5d7544CF6a398c0bf1`.
- [ ] Have tx tabs ready for `openMarket`, `bet`, `resolve`, `claim`, and `claimCreator`.
- [ ] Run the final checklist in `docs/submission-checklist.md`.
