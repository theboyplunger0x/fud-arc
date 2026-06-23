# Arc Metadata Endpoint Runbook

The Arc contract is intentionally asset-agnostic. Rich labels such as ticker,
entry price, timeframe, caller, and social takes come from a separate
`/arc/markets-meta` endpoint.

## Production rule

Do not deploy the `FUDmarkets-arc` `arc-demo` branch over the shared
`fud-backend` Railway service. As of 2026-06-23 that branch is far behind
`origin/main`; deploying it would regress recent production work.

## Safe paths

1. Local video path: run the `arc-demo` backend locally, point
   `NEXT_PUBLIC_ARC_META_URL` at localhost, and record the rich-card flow.
2. Isolated always-on path: create a separate Railway service for the Arc demo
   backend and point `fud-arc-hackaton` at that service.
3. Mainline path: rebase the Arc demo commits onto current `main`, re-test the
   full backend, then deploy through the normal backend release process.

## Demo seed

`NEXT_PUBLIC_DEMO_SEED=1` is for local preview only. Production builds ignore it
in code, even if the variable is accidentally set in Vercel.
