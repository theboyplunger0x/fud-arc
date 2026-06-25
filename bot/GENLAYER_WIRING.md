# GenLayer resolution runbook

GenLayer is now the bot's primary resolution path. At market close,
`resolverTick()` calls `resolutionPrice(ticker, pythId)`, which tries GenLayer
first and falls back to Pyth Hermes only if GenLayer fails or times out.

## Live pieces

- `src/genlayer.ts` — GenLayer client, `getPriceFromGenLayer()`, timeout wrapper,
  and `resolutionPrice(ticker, pythId)`.
- `src/intelligent-oracles/price_oracle_v2.py` — Intelligent Contract used at
  resolution time. It fetches Pyth plus Coinbase/CoinGecko for crypto majors,
  and Pyth-only for FX pairs.
- `src/index.ts` — `resolverTick()` uses `resolutionPrice()` for settlement and
  logs `via genlayer:studionet`, `via genlayer:bradbury`, or `via pyth`.
- `scripts/test_genlayer.ts` — smoke proof for BTC and EUR/USD.

## Railway env

Required on the bot service:

```sh
GENLAYER_PRIVATE_KEY=<studionet or bradbury key>
ARC_GENLAYER_NETWORK=studionet
GENLAYER_TIMEOUT_MS=75000
```

Use `ARC_GENLAYER_NETWORK=bradbury` only when the key has GEN gas and the
multi-validator path is intentionally enabled.

## Framing

For the current deployed bot, say: **resolved by GenLayer over live price
sources, with Pyth fallback**.

Do not say "GenLayer consensus" for studionet. Studionet is the live GenLayer
execution path, but Bradbury is the multi-validator consensus network.

## Optional phase 2

`resolutionPrice()` returns `{ via, oracleAddress, resolveHash, confidence,
sources }`. To make the proof visible in the frontend, persist those fields on
the market record, serve them through `/arc/markets-meta`, and render a resolved
badge linking to the GenLayer oracle.
