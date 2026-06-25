# FUD on Arc — agent-driven P2P conviction markets

> **An agent turns a social trade call into a P2P USDC market on Arc — and the creator who made
> the call earns a cut.** Built for the **Lepton Agents** hackathon (Arc · Canteen · Circle).
> Hits **RFB #1 (Autonomous Paying Agents)** + **#6 (Creator & Publisher Monetization)**.

FUD is **live on Base** with P2P conviction markets (crypto runs on conviction, but conviction has
no market — FUD makes opinions liquid). This repo is the **Arc-native, agent-driven** build: a bot
takes a call like `@fudmarkets open long $100 on <CA> 1h`, opens a stablecoin-native market on Arc,
matches a counterparty, and settles on-chain — paying the creator who brought the call.

---

## What's built (in the 2-week window)

| Piece | What it is | Where |
|---|---|---|
| **Contract** | `FudArcMarket` — minimal two-sided P2P USDC escrow: open → bet LONG/SHORT → resolve → winners claim (stake + pro-rata of the net losing pool) → **opener claims a creator cut**. Pull-based payouts, zero-address guards, a full unit suite (~93% branch coverage, independently security-reviewed: 0 critical/high), `forge fmt`-clean, green CI. | [`src/FudArcMarket.sol`](src/FudArcMarket.sol) |
| **Agent** | The live FUD Telegram bot: a social call becomes an on-chain market on Arc, resolved at close by GenLayer with Pyth fallback. | [`bot/`](bot/) |
| **Frontend** | Next.js dashboard (FUD design system) that reads the markets **on-chain** from Arc and shows the live loop. | [`web/`](web/) |

## Judge quick path

**Start here:** [`docs/OVERVIEW.md`](docs/OVERVIEW.md) — the full thesis, architecture, economics, oracle approach, and what's real vs roadmap.

1. **Try the product:** open the deployed frontend at [`fud-arc-hackaton.vercel.app`](https://fud-arc-hackaton.vercel.app) and watch live Arc markets read straight from chain.
2. **Verify the contract:** inspect `0x57352a7983E57De691fcEa5d7544CF6a398c0bf1` on Arcscan and follow `openMarket → bet → resolve → claim / claimCreator`.
3. **Review the repo:** `forge test -vvv` runs 28/28 tests (incl. a fuzz conservation invariant); CI covers Foundry fmt/build/tests plus frontend lint/build.
4. **Watch the demo:** the 2-3 minute walkthrough follows [`docs/demo-script.md`](docs/demo-script.md); final submission prep lives in [`docs/submission-checklist.md`](docs/submission-checklist.md).

```
 Telegram call ──▶ agent ──▶ openMarket() on Arc ──▶ counterparty bet()
                                                          │
   creator cut ◀── claimCreator() ◀── resolve(outcome) ◀─┘   (settled in USDC, on-chain)
```

---

## Live on Arc testnet

```
FudArcMarket:  0x57352a7983E57De691fcEa5d7544CF6a398c0bf1
Explorer:      https://testnet.arcscan.app/address/0x57352a7983E57De691fcEa5d7544CF6a398c0bf1
RPC:           https://rpc.testnet.arc.network        Chain ID: 5042002
Gas token:     USDC  (native = 18 decimals; ERC-20 interface = 6 decimals at 0x3600…0000)
Faucet:        https://faucet.circle.com
```

The escrow speaks the **6-decimal ERC-20 USDC** interface for all deposits/payouts (Arc's USDC is
both the gas token at 18 decimals and a 6-decimal ERC-20 — the contract uses the ERC-20 side).

## Partner & settlement

**GenLayer** is the primary resolution path for the Arc bot today: at close, the bot deploys a
GenLayer Intelligent Contract that reads live price sources (Pyth plus Coinbase/CoinGecko for
crypto majors; Pyth-only for FX) and uses that price to call `resolve()` on Arc. Pyth Hermes remains
the fallback so settlement does not stall if GenLayer times out. **Native USDC on Arc/Circle** is the
settlement rail. The core carries no liquidity dependency beyond counterparties: in a P2P market the
counterparty *is* the liquidity.

---

## Run it

**Contract (Foundry):**
```bash
forge build
forge test -vvv
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast   # after filling .env
```

**Frontend (Next.js):**
```bash
cd web
npm ci
npm run dev      # http://localhost:3000 — reads the live Arc markets
```

## Roadmap
1. ✅ **USDC escrow on Arc** — open / bet / resolve / claim + creator cut, deployed + smoke-tested.
2. ✅ **Agent → Arc** — the Telegram bot creates markets on Arc, auto-resolved at close.
3. ✅ **Frontend** — on-chain market dashboard in the FUD design system.
4. **Signature-based P2P matching** — take the other side with one signature, no manual tx.
5. ✅ **GenLayer-driven resolution on Arc** — the bot resolves through GenLayer first, then Pyth fallback, and settles via `resolve()`.
6. ✅ **Multi-asset** — crypto + FX canonical markets, settled in USDC on Arc; stocks later.

---

*FUD makes opinions liquid — every take becomes a position. This is the stablecoin-native, agentic
version, built on Arc.*
