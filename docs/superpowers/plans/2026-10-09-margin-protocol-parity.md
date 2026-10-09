# Терминал на протокольной марже (MR-100) — план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, одна задача
> на диспатч, ревью после каждой. State: `.claude/plans/2026-10-09-margin-protocol-parity/`.

**Plane:** MR-100 (арка margin-protocol-parity, корень TRM-40); баги TRM-5, 6, 12, 14, 28, 35, 36.
Близнец — MR-101 (liqu-web, `liqu-fi/liqu-web` ветка `feat-cld/margin-protocol-parity`).
**Branch:** `feat-cld/margin-protocol-parity` от `origin/main` @ a8097c50 (SDK `@liq/*` 0.67.0 —
PR #74). PR — draft в `main`. Деплой prod сейчас не работает (MR-113, Vercel) — план от этого не зависит.

**Goal:** терминал показывает числа протокола: Margin и Liq. Price тикета — из превью контракта по
цене вкладки, предупреждение — по `validateOrder` против `free` гейтвея, Equity = available и
отдельная строка «In orders», usage — `useMarginUsage`, колонка позиций «Req. margin» с подсказкой,
бейдж плеча на позиции убран.

## Решения владельца (TRM-40, 2026-10-08)

1. Плечо в cross — только калькулятор размера; Margin тикета = требование протокола.
2. Колонка Margin позиций = начальная маржа протокола, подпись «Req. margin».
3. Equity = available; locked — отдельной строкой «In orders».
4. Usage = требуемая начальная маржа (с наградой ликвидатора) / available; долг — отдельно.
5. Гейтвей (MR-102) допускает ордер, если `available − locked ≥ R1`, и блокирует `max(0, R1 − R0)`.

## Дизайн-заметки

- `useOrderMarginPreview(...).requiredMargin` = R1 — требование **всего аккаунта** после ордера
  (с наградой ликвидатора и комиссией). Строка «Margin» тикета = `max(0, R1 − R0)`, R0 =
  `useMarginUsage(...).data.requiredInitialMargin` — ровно то, что заблокирует гейтвей. Предупреждение
  `validateOrder`: `requiredMargin = R1`, `free` гейтвея — `R1 > free` ⇒ гейтвей отклонит (обратное не гарантировано: превью не учитывает убыток fill−mark, `validateOrder` — «необходимо, не достаточно»).
- Цена превью = цена вкладки: Market → mark, Limit → введённая цена (`parsedTabPrice()`,
  `TradeForm.tsx:143-147`). Знаковый размер на сторону уже есть: `summary.long/short.sizeDelta`.
- У тикета две кнопки (long/short) и две строки Liq. Price («long / short») — превью на каждую сторону.
- Сокращающий ордер на prod: R1 может быть ≤ R0 → «Margin» = $0.00 (гейтвей ничего не блокирует).
- `useAccountSummary.ts` держит свой `useQuery` маржи гейтвея с ключом
  `["terminal","account-margin",id]` — заменить на SDK `useAccountMargin` (его ключ сбрасывается SDK
  на `orderStateChanged` и прочих событиях), один источник для счёта и тикета.

## Global Constraints

- SDK `@liq/*` 0.67.0, не бампать. Node 24.14.0 (`.prototools`), pnpm 11.1.2.
- Гейты каждой задачи: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`
  (tier1, моки, без секретов). `useTerminalUiStore.test.ts` падает на Node 26 — запускать на 24.14.0.
- Vitest в репо — `environment: "node"`, `@testing-library` нет: логика — в чистых `.ts`, хуки
  проверяются через e2e tier1. Новую тестовую инфраструктуру не вводить.
- e2e-мок цепи (`e2e/support/chain.ts`) не знает `requiredMarginForOrderWithPrice`: Task 1
  добавляет обработчик, иначе превью в e2e не загрузится.
- Коммиты через хук, никогда `--no-verify`; сообщения через файл + `git commit -F`.
- Слово «LiqCx» нигде не писать. Ключей и транзакций нет.

## Review Focus

1. Превью грузится / упало / аккаунта нет → Margin и Liq. Price «—», без предупреждения.
2. Limit без цены → превью не запрашивается, submit заблокирован как сейчас (`tabPriceReady`).
3. Сокращающий ордер → Margin $0.00, без предупреждения; сверх `free` → предупреждение, submit не блокируется.
4. Аккаунт под водой → usage «—», не 0 % и не 100 %; долг отдельно.
5. Позиция без `initialMarginUsd` → «—», не $0.00.

---

### Task 1: тикет — Margin, Liq. Price и предупреждение из превью по цене вкладки

**Files:**
- Modify: `src/features/trade/TradeForm.tsx` (:56-64 вызов `useOrderSizing`, :143-147 цена вкладки, :447-451 `OrderSummary`, :472-476 предупреждение) — передать в `useOrderSizing` цену вкладки и `accountId`
- Modify: `src/features/trade/useOrderSizing.ts` (:89-156) — два `useOrderMarginPreview` (long/short по `summary.long/short.sizeDelta`, цена вкладки), R0 из `useMarginUsage`, `validateOrder({ …, requiredMargin: R1 стороны с большим размером, free })`; убрать `mmfWad` (:118-123), если больше не нужен
- Modify: `src/features/trade/ticketSummary.ts` (:41-98) — убрать `draftLiquidationPrice` и `cost = marginCost(...)` как «маржу»; оставить `value` (notional) и `sizeDelta`; `marginCost` используется только для калькулятора размера
- Create: `src/features/trade/orderMarginView.ts` — чистые функции: `lockAmount({r1?, r0?})` = `max(0, r1 − r0)` / `undefined`; `rowsView({long, short})` → строки «Margin» и «Liq. Price» («—» для неизвестного)
- Modify: `src/features/trade/OrderSummary.tsx` (:35-43) — строка «Cost» → «Margin» (`order-margin`, `lockAmount` по стороне), Liq. Price — из превью
- Modify: `e2e/support/chain.ts` — обработчик `requiredMarginForOrderWithPrice` (и чтений, которые делает `getOrderMarginPreview` в той же мультиколле — сверить с `@liq/onchain` 0.67 `order-margin-preview`), управляемый из `world.ts`
- Modify: `e2e/tier1/07-trade-gating.spec.ts` — вернуть позитивную проверку «Exceeds available margin» в кейсе «beyond buying power» (мок: R1 > free); кейс сводки (~:143-153) — новые строки/значения; `e2e/pages/TerminalPanels.ts` — локатор `orderMargin`
- Test: `src/features/trade/__tests__/orderMarginView.test.ts`, правки `ticketSummary.test.ts`

- [ ] **Step 1:** Тест `orderMarginView`: R1>R0 → разница; R1≤R0 → 0n; неизвестное → undefined; `rowsView` — «—» для undefined, «$0.00» для 0n. Красный → реализация → зелёный.
- [ ] **Step 2:** `useOrderSizing` и `TradeForm` — превью, R0, `free` (из `useAccountMargin`, уже подключён в #74), `validateOrder` с R1. Правило выбора стороны для `requiredMargin` (большая по размеру) — задокументировать в TSDoc.
- [ ] **Step 3:** `ticketSummary`/`OrderSummary` — строки; «Cost» как маржа исчезает.
- [ ] **Step 4:** e2e-мок превью и обновлённые e2e (07, сводка). Предупреждение снова проверяется позитивно, submit остаётся доступен.
- [ ] **Step 5:** Гейты (все пять). Мутационные пробы: `requiredMargin = lockAmount` вместо R1 — e2e «beyond buying power» должен покраснеть при R1>free≥lock; «—»↔«$0.00».
- [ ] **Step 6:** Коммит, push.

**Done:** Margin тикета = сумма блокировки гейтвея; Liq. Price — оценка протокола по цене вкладки; предупреждение совпадает с решением гейтвея; `draftLiquidationPrice` не используется.

### Task 2: счёт — Equity, «In orders», usage на SDK

**Files:**
- Modify: `src/features/account/useAccountSummary.ts` (:11-21, :58-80) — `useAccountMargin` вместо локального `useQuery`; `equity = available` (решение 3), `inOrders = locked`; `usage` из `useMarginUsage(...).data.usage` (WAD), долг — как сейчас отдельно
- Modify: `src/features/account/accountLogic.ts:112-119` — удалить локальный `marginUsage` (затеняет SDK); формат WAD→% — в чистой функции
- Modify: `src/features/account/AccountPanel.tsx` — строка «In orders» (`account-in-orders`) рядом с Equity; `OverviewTab.tsx:247-250`, `PortfolioTab.tsx:167-170` — usage из SDK
- Test: `accountLogic.test.ts` (:110-117 переписать на новую функцию формата), `accountSummary.test.ts` (:78, :95, :104), `e2e/tier1/24-account-panel.spec.ts` (Equity при available 5000 / locked 40 = «$5,000.00», «In orders» = «$40.00»)

- [ ] **Step 1:** Тесты: usage WAD 0.286e18 → «28.6 %»; undefined → «—»; equity = available; inOrders = locked. Красные → реализация.
- [ ] **Step 2:** Подключение в панели и вкладках; e2e 24 обновить, `chain.ts` мока — `getRequiredMargins` уже есть (:204), задать ненулевое значение для кейса usage.
- [ ] **Step 3:** Гейты + пробы (поменять equity на available−locked — e2e 24 краснеет). Коммит, push.

**Done:** Equity не прыгает после выставления ордера; usage с долгом ≠ 100 %; один источник маржи гейтвея.

### Task 3: позиции — «Req. margin» и плечо

**Files:**
- Modify: `src/features/positions/PositionsTable.tsx` (:104-111 колонка Margin, :55-62 бейдж плеча) — заголовок «Req. margin» с подсказкой (`src/components/ui/tooltip.tsx`): «Initial margin the protocol requires for this position — a size- and skew-dependent share plus the liquidation reward»; бейдж плеча на строке позиции убрать (это `leverageFor` = notional/available аккаунта, плечо аккаунта уже в панели счёта — TRM-12)
- Test: `positionRows.test.ts` при необходимости; `e2e/tier1/08-positions.spec.ts` — заголовок колонки и отсутствие бейджа (индексы колонок не менять)

- [ ] **Step 1:** Правки, e2e 08 — проверка заголовка «Req. margin» и подсказки, отсутствие бейджа.
- [ ] **Step 2:** Гейты. Коммит, push, draft PR в `main` (русское описание, MR-100 + TRM-5/6/12/14/28/35/36, что изменилось в UI, `🤖 Generated with [Claude Code](https://claude.com/claude-code)`).

**Done:** колонка подписана и объяснена; бейджа плеча на позиции нет; PR открыт.
