# FUD on Arc — Submission Checklist

Use this as the final pre-flight before recording and submitting. Keep contract code frozen unless a blocker appears.

## Submission Fields

- Product name: **FUD on Arc**
- One-liner: **An agent turns social trade calls into P2P USDC conviction markets on Arc, and the creator earns a cut.**
- Repo: `https://github.com/theboyplunger0x/fud-arc`
- Contract: `0x57352a7983E57De691fcEa5d7544CF6a398c0bf1`
- Explorer: `https://testnet.arcscan.app/address/0x57352a7983E57De691fcEa5d7544CF6a398c0bf1`
- Frontend URL: `https://fud-arc-hackaton.vercel.app`
- Video URL: `TODO`
- Team/socials: `TODO`

## Final Local Checks

Run from repo root:

```bash
forge fmt --check
forge build --sizes
forge test -vvv

cd web
npm ci
npm run lint
npm run build
```

Expected result: Foundry green, frontend lint/build green, no contract redeploy needed.

## Demo State

- [ ] Deployer/operator key funded with Arc testnet USDC for gas and ERC-20 escrow.
- [ ] At least one **LIVE** market visible in the frontend.
- [ ] At least one **resolved** market visible with a nonzero fee / creator cut.
- [ ] (Optional) Show **multi-asset**: type an FX pair (e.g. `EUR/USD`) — priced off-chain via Pyth.
- [ ] Explorer tabs prepared for the contract and the key txs: `openMarket`, `bet`, `resolve`, `claim`, `claimCreator`.
- [ ] Telegram bot on `arc-demo` branch running with `ARC_DEMO_ENABLED=1`.
- [ ] GenLayer path shown if available; fallback resolution phrased as demo fallback, not core ownership.

## Recording Flow

1. Hook: FUD is live on Base; Arc version makes it agentic and USDC-native.
2. Telegram call (a crypto CA, or an FX pair like `EUR/USD`): the bot opens an Arc market — multi-asset.
3. Arcscan: show real escrow transactions.
4. Frontend: show live on-chain markets, countdown, pools, resolved market.
5. Settlement: explain GenLayer outcome relay and pull-based claims.
6. Close: autonomous paying agents + creator monetization, open-source and forkable.

## Submission Notes

- Do not squash commits; judges care that work happened inside the window.
- Submit early if possible, then update with the final video/frontend URL.
- If using ARC-CLI, use the commands from `docs/CONTEXT.md` after login and keep product/traction updates concise.
