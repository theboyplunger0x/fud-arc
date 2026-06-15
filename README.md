# FUD on Arc — Hackathon (Lepton Agents)

The agentic version of FUD: a bot turns social trade calls into P2P USDC
conviction markets on **Arc**, resolved by **GenLayer**, where the **opener
(creator) earns a cut**. Hits RFB #1 (Autonomous Paying Agents) + #6 (Creator &
Publisher Monetization).

> FUD is live on Base with P2P conviction markets. On Arc we build the
> stablecoin-native, agent-driven version — and pay the creators who bring the calls.

## Status — Step 1: minimal escrow

`src/FudArcMarket.sol` — two-sided P2P market escrow in USDC:
open → bet LONG/SHORT → operator resolves → winners claim (stake + pro-rata of
the net losing pool) → opener claims creator cut. Fee 10% of the losing pool,
opener earns 20% of the fee (the on-chain version of FUD's opener fee).

This proves the Arc mechanics (USDC approvals, escrow, settlement, payout)
before porting the full lazy/signature-matched P2P flow + GenLayer resolution.

## Arc testnet
- RPC: `https://rpc.testnet.arc.network`
- Chain ID: `5042002`
- Gas token: **USDC** (native = 18 decimals; ERC-20 interface = 6 decimals at `0x3600…0000`)
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com`

## Dev

```bash
forge build
forge test -vvv

# deploy (after filling .env)
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
```

## Roadmap
1. ✅ Minimal escrow (this) — open/bet/resolve/claim + creator cut.
2. Lazy/signature-matched P2P (port LazyBet / createAndPlaceBet from FUD Base).
3. GenLayer → Arc settlement bridge (resolve price off-chain, settle USDC on Arc).
4. Bot (Telegram + X) pointed at Arc.
5. Multi-asset: crypto + FX canonical markets via Pyth/Stork pull oracle (stocks = later).
6. Frontend (FUD design system) + demo.
