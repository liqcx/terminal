# End-to-end tests

Two tiers of Playwright e2e: a hermetic mocked tier that runs in CI and a live
opt-in tier. Both use an injected viem wallet, Page Objects keyed on `data-testid`,
and the connect → create-account → SIWE → trade lifecycle.

## Tier 1 — hermetic (default, CI)

`pnpm test:e2e`

Fully self-contained: no secrets, no live backend, deterministic, runs in CI.
The Playwright config (`playwright.config.ts`) launches the dev server with fixed
fake origins (`gateway.e2e.local`, `rpc.e2e.local`) and `VITE_E2E_WALLET=true` —
the product's only login is Turnkey, which cannot be mocked hermetically, so
that build-time constant swaps the single wagmi connector for `injected()` and
shows a plain Connect button (`src/config/env.ts`). Every request is intercepted
in-process:

- **`support/injectedWallet.ts`** — an EIP-1193 `window.ethereum` that signs with
  canned signatures and turns sends into world mutations + receipts.
- **`support/mockChain.ts` + `chain.ts`** — a viem-encoded JSON-RPC endpoint that
  answers `eth_call` (including Multicall3 `aggregate3` batches) and serves
  receipts, driven by a mutable **`MockWorld`** (`support/world.ts`).
- **`support/mockGateway.ts`** — the order-gateway REST + SSE, also driven by the
  world. Responses are bare shapes (the SDK parser returns `json.data ?? json`).

A test picks a scenario by seeding the world before navigating:

```ts
import { enterTerminal } from "../pages/flows";
const { trade, userInfo } = await enterTerminal(page, world, () =>
  readyWorld({ openOrders: [limitOrderFixture()] }),
);
```

Coverage (`tier1/`): boot + onboarding, market data, deposit/withdraw, market /
limit / conditional orders, form gating, positions, open orders + cancel,
history, live SSE updates, error states, disconnect.

1-click trading has no hermetic tier: since #50 the session key is the SDK-managed
Turnkey session (no pill, no manual grant), and the enclave cannot be mocked.

## Tier 2 — live (opt-in)

`pnpm test:e2e:live`

The real SPA against a real order-gateway + RPC, with a real (mnemonic-derived)
wallet doing real SIWE + EIP-712 signing and on-chain transactions — the
highest-fidelity check. **Skips entirely (green) unless configured**, so it never
blocks the default run or CI.

To run it, copy `../.env.e2e.example` to `.env.e2e.local`, fill in the gateway URL
+ a **funded testnet** mnemonic, export the vars, then run the live config:

```bash
set -a; . ./.env.e2e.local; set +a
pnpm test:e2e:live
```

Tier 2 reuses the same Page Objects as Tier 1; only the wallet + backend differ
(`tier2/liveWallet.ts`, `tier2/ensureTradeReady.ts`). Live fills can be slow on
staging — timeouts are governed by `E2E_FILL_TIMEOUT_MS`.
