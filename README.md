# Reference Perp Trading Terminal

A small, forkable **reference trading terminal** for a decentralized perp-futures exchange
(offchain orderbook, onchain settlement on a Synthetix V3 fork). It demonstrates the canonical way
to build a trading UI on the `@liq/*` SDK: **connect → authenticate (SIWE) → create account &
deposit → sign & submit orders → watch live updates**. Single-market, neutral-themed, testnet
(chainId 6343). Fork it and reskin via design tokens.

> Intentionally minimal and readable end-to-end — meant to be forked and white-labeled.

## Quickstart

**Prereqs:** Node 24 + pnpm 11 (`proto use`), a browser wallet (MetaMask), and testnet funds
(chainId 6343). The SDK (`@liqpro/*`) installs from public npm — no registry token needed.

1. **Configure the backend.**
   ```bash
   cp .env.example .env
   # set VITE_GATEWAY_URL to your order-gateway base URL, INCLUDING the API
   # version path — e.g. https://gateway.example.com/v1 (the SDK appends bare
   # routes like /markets, so the /v1 prefix must be part of this URL).
   ```

> **Вход — только через Turnkey.** Задайте `VITE_TURNKEY_ORG_ID` и
> `VITE_TURNKEY_AUTH_PROXY_CONFIG_ID` из дашборда Turnkey (раздел Wallet Kit) — без них экран
> входа объясняет, чего не хватает. Вход по коду на почту или подписью внешнего кошелька создаёт
> пользователю кошелёк в TEE; он создаётся пустым — ETH на газ для первой транзакции нужно прислать
> самому (ссылка на фаусет MegaETH есть в диалоге Faucet).

2. **Install & run:**
   ```bash
   pnpm install
   pnpm dev
   ```
   Open the printed URL, sign in with Turnkey, and follow the on-screen CTAs.

> **CORS:** the SPA calls the gateway (REST + SSE) directly, so the gateway must allow this
> origin. There is no dev proxy — a gateway that refuses `localhost` has to be fixed on its side.

### SDK packaging note

The `@liq/*` dependencies in `package.json` are npm aliases onto the published `@liqpro/liq-*`
packages — the short specifier is what the app imports. Only the five packages the app imports
directly are listed; the rest (`liq-onchain`, `liq-prices`, `liq-subgraph`) arrive transitively
through `@liq/sdk` and `@liq/react`, which reference them by their full names.

## Trade lifecycle ↔ SDK calls

Every step maps to a hook from `@liq/react` (or a class from `@liq/sdk`):

| Step                     | What happens                                      | SDK                                            | Code                                        |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Sign in (Turnkey)        | код на почту / подпись кошелька → встроенный кошелёк в TEE | `TurnkeyProviderWrapper`, `createEmbeddedWallet` | `features/auth/TurnkeyLoginButton.tsx`      |
| Connect (wallet)         | wagmi wallet connect                              | wagmi `useConnect`                             | `features/wallet/ConnectButton.tsx`         |
| Create account           | mint SNX account NFT                              | `useCreateAccountMutation`                     | `features/auth/SessionCta.tsx`              |
| Sign in                  | SIWE personal_sign → JWT (+ book mode + register) | `useGatewayAuthMutation`                       | `features/auth/SessionCta.tsx`              |
| Deposit                  | USDC→sUSDC→modifyCollateral multicall             | `useDepositMutation`                           | `features/account/DepositDialog.tsx`        |
| Markets / price          | list + live price                                 | `useMarketsQuery`, `usePricesQuery`            | `features/market/*`                         |
| Chart                    | candles backfill + live 1m                        | `client.candles.history/subscribe`             | `features/chart/*`                          |
| Preview                  | fees / fill / impact                              | `useTradePreview`                              | `features/trade/TradePreviewRow.tsx`        |
| Submit (market/limit)    | sign EIP-712 order → POST                         | `useSubmitMarketOrder` / `useSubmitLimitOrder` | `features/trade/TradeForm.tsx`              |
| Conditional (TP/SL/Stop) | standalone trigger order                          | `useSubmitConditionalOrder`                    | `features/trade/TradeForm.tsx`              |
| Positions / orders       | live state                                        | `useEnrichedPositions`, `useOpenOrdersQuery`   | `features/positions/*`, `features/orders/*` |
| Cancel                   | cancel resting order                              | `useCancelOrderMutation`                       | `features/orders/OpenOrdersTable.tsx`       |
| Live updates             | order status over SSE                             | `useSseOrderUpdates`                           | `features/userinfo/useLiveOrders.ts`        |

**Key facts:** auth is **SIWE** (personal_sign), not EIP-712 — only orders are EIP-712 signed.
Order numeric fields are decimal strings of 18-dec bigints. `sizeDelta` is signed (negative = short).
Both deploy environments share chainId 6343 — `VITE_DEPLOY_ENV` (handed to the SDK via `setDeployEnv`
in `src/deploy-env-init.ts`) selects the contract set; chain and RPC come from the SDK's `getViemChain`.

## Where things live

- `src/providers/` — `LiqSetup` builds the SDK client + onchain singletons and mounts the provider;
  the JWT→client sync lives here.
- `src/config/` — chain + wagmi config + typed env.
- `src/features/<name>/` — one folder per concern (wallet, auth, market, chart, trade, positions,
  orders, history, account).
- `#/account` — full-screen Account page (`src/features/account/AccountPage.tsx`): Overview /
  Portfolio / Assets / Transactions on live SDK reads; hash routing in `src/lib/hashRoute.ts`, no
  router dependency.
- `src/lib/format.ts` — the single tested formatting layer (WAD bigint → display).
- `src/styles/tokens.css` — design tokens.

## Reskin

All colors/spacing/radii are CSS variables in `src/styles/tokens.css`, surfaced to Tailwind v4 via
`@theme` in `src/styles/index.css`. Change the tokens; the whole UI follows. No component edits needed.

## Extend here

- **Bracket orders (TP/SL attached to a position):** the convenience hooks don't wire `groupId`;
  drop to `client.orders.submit` with a shared `groupId` to link legs (cancel-other-on-fill).
- **Session keys / embedded wallets:** wrap the tree in the SDK's session-key provider and use
  `useSessionKey` for gasless signing.
- **Multi-market dashboard, stats, funding charts, mobile layouts, i18n, faucet** — each is a
  self-contained add-on; the read hooks (`useStatsQuery`, `client.markets.getFundingHistory`,
  `useClaimFaucetMutation`) already exist in the SDK.

## License

Apache-2.0.
