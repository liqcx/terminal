# Ф2 · Защита позиции (terminal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Терминал на SDK 0.65.0 показывает скобками позиции только её ноги и их действующий размер, а Close
больше не снимает скобки сам — это делает backend после расчёта.

**Architecture:** Миграция на новую сигнатуру `positionBrackets(position, conditional)`; `Bracket.effectiveSize` —
в таблице Open Orders и диалоге TP/SL; закрытие позиции — одна подача, без отмены скобок; тост о снятии скобок
приходит сам (Ф1: `CANCELLED` с причиной) — его закрепляет e2e.

**Tech Stack:** React 19, TanStack Query/Table, `@liq/*` = `@liqpro/liq-*` 0.65.0 (npm), Vitest (unit), Playwright
в Docker-раннере (e2e), pnpm.

**Spec:** `~/Work/perps/monorepo/docs/superpowers/specs/2026-10-06-f2-position-protection-design.md` (решения 6, 7,
8, 9) — в ветке `feat-cld/f2-position-protection` monorepo, после мержа — в `staging`.

## Global Constraints

- SDK: все `@liq/*` → `npm:@liqpro/liq-*@^0.65.0` (опубликован владельцем после мержа monorepo; до публикации задача 1
  не стартует — проверить `npm view @liqpro/liq-core version`).
- Скобка позиции (SDK 0.65.0): тот же рынок, `reduceOnly`, `TAKE_PROFIT*`/`STOP*`, `TRIGGER_PENDING`, сторона против
  позиции; `effectiveSize = min(size, |position.size|)`.
- Подсказка урезанного размера: текст `capped to position size`, testid `order-size-capped` (Open Orders) и
  `tpsl-size-capped` (диалог TP/SL).
- Слова тоста снятия скобки (SDK): заголовок `Stop loss cancelled` / `Take profit cancelled`, detail
  `The position was closed.` / `The position was reversed.` / `There is no open position to protect.`
- Node — proto 24.14.0 (`export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH"`; mise-Node 26 ломает тест
  localStorage). pnpm — через `rtk proxy`. e2e — только Docker-раннером `~/Work/perps/terminal/.worktrees/e2e-docker.sh`
  (на хосте Ubuntu 26.04 нет библиотек Chromium).
- PR — draft, база `main`, в заголовке TRM-n. Коммиты по-русски, trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Позиции нет, а ноги стоят (сироты до сверки, ноги лимитного входа) — в колонке TP/SL пусто, в Open Orders ноги
   видны отдельными строками с Cancel, редактор TP/SL новой позиции их не трогает. Тест — задача 1, шаг 2
   («нога другой стороны…») и задача 3, шаг 1 («сирота…»).
2. Закрытие не исполнилось (отказ шлюза) — скобки на месте. Тест — задача 2, шаг 1 (`cancelledOrderIds` пуст при
   любом исходе подачи).
3. Скобка больше позиции после частичного закрытия — показан действующий размер и в таблице, и в диалоге. Тест —
   задача 3, шаг 4.
4. Тикет на рынке без позиции с TP/SL — план входа ставит новые ноги, не находя «скобок» чужих сирот. Тест —
   задача 1 (TradeForm: `positionBrackets(openPosition, …)`), e2e `04-trade-market` (скобки входа) в шаге 4.
5. Снятие скобки сервером — тост с причиной. Тест — задача 2, шаг 3.

---

### Task 1: SDK 0.65.0 — скобки позиции только свои

Спек: решение 6. Закрывает TRM-9 на экране.

**Files:**
- Modify: `package.json:21-25`, `pnpm-lock.yaml` (`@liq/*` → `^0.65.0`)
- Modify: `src/features/positions/usePositionRows.ts:55-70` (`buildPositionRows` → `positionBrackets(position, …)`)
- Modify: `src/features/trade/TradeForm.tsx:157-160` (`positionBrackets(openPosition, conditional)`)
- Modify: `e2e/support/world.ts:668-685` (`conditionalOrderFixture` + `reduceOnly: true`), фикстуры открытых ордеров
  там же (`reduceOnly: false`), место в `e2e/support/mockGateway.ts`, где принятый `POST /orders` превращается в
  `GatewayOrder` списка (`git grep -n "conditionalOrders.push\|openOrders.push" -- e2e/support`) — `reduceOnly: payload.reduceOnly === true`
- Test: `src/features/positions/__tests__/positionRows.test.ts`

**Interfaces:**
- Consumes: SDK 0.65.0 — `positionBrackets(position: Pick<Position,'marketId'|'size'> | null | undefined, conditional)`,
  `Bracket.size`, `Bracket.effectiveSize`, `GatewayOrder.reduceOnly`.
- Produces: `buildPositionRows<P extends { marketId: bigint; size: bigint }>` (позиции нужен знаковый размер);
  `PositionRow.brackets.*.effectiveSize` для задачи 3.

- [ ] **Step 1: SDK**

```bash
rtk proxy pnpm up "@liq/api-client@npm:@liqpro/liq-api-client@^0.65.0" "@liq/core@npm:@liqpro/liq-core@^0.65.0" \
  "@liq/react@npm:@liqpro/liq-react@^0.65.0" "@liq/sdk@npm:@liqpro/liq-sdk@^0.65.0" \
  "@liq/turnkey@npm:@liqpro/liq-turnkey@^0.65.0"
rtk proxy pnpm typecheck
```

Expected: ошибки типов ровно в двух вызовах `positionBrackets` и в фикстурах `GatewayOrder` без `reduceOnly`.

- [ ] **Step 2: Падающие unit-тесты**

В `positionRows.test.ts`: фабрика `trigger()` получает `reduceOnly: true`, позиции в тестах — `{ marketId, size }`
(`size: 10n ** 18n` для длинной), и новые кейсы:

```ts
  it("нога другой стороны — не скобка: сирота закрытой короткой у новой длинной (TRM-9)", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: 10n ** 18n }],
      markets: MARKETS,
      prices: undefined,
      conditional: [trigger({ side: "BUY", sizeDelta: "1000000000000000000" })],
    });
    expect(row.brackets.takeProfit).toBeNull();
  });

  it("действующий размер скобки — не больше позиции", () => {
    const [row] = buildPositionRows({
      positions: [{ marketId: 200n, size: 10n ** 18n / 2n }],
      markets: MARKETS,
      prices: undefined,
      conditional: [trigger({ id: "tp-9" })],
    });
    expect(row.brackets.takeProfit?.size).toBe(10n ** 18n);
    expect(row.brackets.takeProfit?.effectiveSize).toBe(10n ** 18n / 2n);
  });
```

Run: `rtk proxy pnpm vitest run src/features/positions/__tests__/positionRows.test.ts`
Expected: FAIL (типы/ожидания).

- [ ] **Step 3: Миграция вызовов**

`usePositionRows.ts`:

```ts
export function buildPositionRows<P extends { marketId: bigint; size: bigint }>(input: {
  // … без изменений
}) {
  return input.positions.map((position) => {
    const key = position.marketId.toString();
    return {
      position,
      symbol: marketSymbol(input.markets, position.marketId),
      markPrice: input.prices?.[key]?.price,
      // Позиция целиком, а не рынок: скобкой считается только нога, которая
      // эту позицию закрывает (SDK 0.65.0). Раньше сирота закрытой позиции
      // становилась «стопом» следующей, и редактор отменял её (TRM-9).
      brackets: positionBrackets(position, input.conditional),
    };
  });
}
```

Если `Position.size` в SDK — брендированный `Qty`, тип-параметр — `size: Qty` (импорт из `@liq/core`). TSDoc
`buildPositionRows` (абзац «Позиция здесь описана одним полем») — «двумя полями: рынок и знаковый размер».

`TradeForm.tsx:157-160`:

```ts
  const brackets =
    marketId === undefined
      ? NO_BRACKETS
      : positionBrackets(openPosition, conditional);
```

(нет позиции — нет скобок, и план входа ставит новые ноги — это и есть поведение SDK 0.65.0).

e2e-фикстуры: `conditionalOrderFixture` — `reduceOnly: true` перед `...overrides`; фикстуры обычных ордеров —
`reduceOnly: false`; мок шлюза при приёме ордера кладёт в список `reduceOnly: payload.reduceOnly === true`.
Фикстуры скобок в спеках e2e, где сторона не закрывает позицию фикстуры (например, BUY-скобка у длинной), —
поправить сторону, а не ослаблять SDK: это была ровно та путаница, которую чинит Ф2.

Run: шаг 2 — PASS. `rtk proxy pnpm typecheck` — PASS. `rtk proxy pnpm vitest run` — PASS.

- [ ] **Step 4: e2e**

Run: `~/Work/perps/terminal/.worktrees/e2e-docker.sh` (весь набор; известные флейки — `28-position-actions` («group-less pair»), `04-trade-market:44`: перепрогнать отдельно, падают и на `main`).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src e2e
git commit -m "feat(positions): SDK 0.65.0 — скобками позиции считаются только её ноги (TRM-9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Close не снимает скобки — их снимает backend после расчёта

Спек: решение 9 (и 1, 8 — тост о снятии). Закрывает TRM-8 на экране: снятие видно тостом.

**Files:**
- Modify: `src/features/positions/usePositionRows.ts:37-43,72-145` (`CloseOutcome`, TSDoc `usePositionRows`, `close`)
- Modify: `e2e/tier1/28-position-actions.spec.ts:66-92` (тест про закрытие со скобками)
- Modify: `e2e/tier1/31-order-outcome-toasts.spec.ts` (тост снятия скобки)
- Test: те же спеки; unit — нет (логика `close` — вызов двух хуков, её проверяет e2e)

**Interfaces:**
- Consumes: задача 1 (SDK 0.65.0).
- Produces: `usePositionRows().close(rows): Promise<{ closed: number; failed: number }>` — поле `cancelled` удалено
  (потребителей нет: `git grep -n "cancelled" -- src/features/positions` — только сам хук).

Почему: терминал отменял скобки **до** подачи закрытия. Если закрытие не исполнится (отказ шлюза, `no_liquidity`),
позиция оставалась без защиты. С Ф2 скобки снимает settler в транзакции расчёта, который закрыл позицию
(`CANCELLED`, причина `position_closed`), — только когда закрытие реально случилось.

- [ ] **Step 1: e2e — закрытие больше не отменяет скобки (падающий)**

В `28-position-actions.spec.ts` тест `"closing cancels the position's brackets and leaves resting limits alone"`
переписать:

```ts
  test("closing submits only the close order — brackets are the backend's to cancel", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      w.conditionalOrders = [
        conditionalOrderFixture({ id: "sl-1" }),
        conditionalOrderFixture({
          id: "tp-1",
          orderType: "TAKE_PROFIT_MARKET",
          triggerPrice: (90_000n * WAD).toString(),
        }),
      ];
      w.openOrders = [limitOrderFixture({ id: "rest-1" })];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.closePosition(MARKET.id).click();
    await userInfo.closeConfirm.click();

    await expect.poll(() => world.submittedOrders.length).toBe(1);
    // Скобки снимает расчёт, закрывший позицию (Ф2): отмена до подачи
    // оставляла позицию без защиты, если закрытие не исполнялось.
    expect(world.cancelledOrderIds).toEqual([]);
  });
```

Run: `~/Work/perps/terminal/.worktrees/e2e-docker.sh e2e/tier1/28-position-actions.spec.ts`
(если раннер не принимает путь — запустить как он принимает фильтр, см. шапку скрипта)
Expected: FAIL — `cancelledOrderIds` = `["sl-1","tp-1"]`.

- [ ] **Step 2: Реализация**

`usePositionRows.ts`:
- `CloseOutcome` — `{ closed: number; failed: number }`, поле `cancelled` и его TSDoc удалить.
- Убрать `useCancelOrdersMutation` из импортов и из хука.
- `close`:

```ts
  const close = useCallback(
    async (target: readonly PositionRow[]): Promise<CloseOutcome> =>
      closePositions(
        target.map((r) => ({
          position: r.position,
          markPrice: Price(r.markPrice ?? 0n),
        })),
      ),
    [closePositions],
  );
```

- TSDoc `usePositionRows` (абзацы «Закрытие снимает и скобки…» и «Сначала отмена, потом закрытие…») заменить:

```ts
/**
 * Строки таблицы позиций и действия над ними.
 *
 * @remarks Закрытие — одна подача на позицию. Скобки закрытой позиции
 * снимает backend в транзакции расчёта, который её закрыл (`CANCELLED`,
 * причина `position_closed`; трейдер видит тост). Терминал раньше снимал их
 * сам и до подачи: неисполненное закрытие оставляло позицию без защиты.
 * Отдыхающие лимитные ордера не трогаются — их закрытие позиции не просило.
 */
```

Если `useClosePositions().close` возвращает больше полей, чем `{ closed, failed }`, — вернуть
`{ closed, failed }` явно.

Run: шаг 1 — PASS. `rtk proxy pnpm typecheck && rtk proxy pnpm vitest run` — PASS.

- [ ] **Step 3: e2e — тост снятия скобки**

В `31-order-outcome-toasts.spec.ts`, рядом с тестом про FAILED:

```ts
  test("a bracket the backend cancels with its position names why", async ({
    page,
    world,
  }) => {
    // TRM-8: скобки закрытой позиции снимает расчёт; трейдер узнаёт об этом
    // тостом, а не из Order History.
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({ conditionalOrders: [conditionalOrderFixture()] }),
    );
    const toasts = new ToastsPanel(page);
    await userInfo.selectTab("open-orders");
    await expect(userInfo.orderRow("ord-cond-1")).toBeVisible();
    await newestConnectionHas(world);

    world.sseFrames = [
      sseOrderUpdateFrame("ord-cond-1", "CANCELLED", {
        reason: "position_closed",
        channel: ACCOUNT_CHANNEL,
      }),
    ];

    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });
    await expect(toasts.outcome).toContainText("Stop loss cancelled");
    await expect(toasts.outcome).toContainText("The position was closed.");
  });
```

Run: `~/Work/perps/terminal/.worktrees/e2e-docker.sh e2e/tier1/31-order-outcome-toasts.spec.ts`
Expected: PASS сразу (слова — из SDK 0.65.0, механика — Ф1). Если FAIL на тексте — SDK не тот: проверить
`node_modules/@liq/core/package.json` version.

- [ ] **Step 4: Весь e2e**

Run: `~/Work/perps/terminal/.worktrees/e2e-docker.sh`
Expected: PASS (флейки — как в задаче 1).

- [ ] **Step 5: Commit**

```bash
git add src/features/positions/usePositionRows.ts e2e/tier1/28-position-actions.spec.ts e2e/tier1/31-order-outcome-toasts.spec.ts
git commit -m "fix(positions): Close не снимает скобки — их снимает расчёт закрытия, тост называет причину (TRM-8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Действующий размер скобки — в Open Orders и в диалоге TP/SL

Спек: решение 7. Закрывает TRM-21 на экране.

**Files:**
- Create: `src/features/orders/cappedSizes.ts` (чистая функция)
- Modify: `src/features/orders/useOpenOrderRows.ts` (`OrderRow.cappedSize`)
- Modify: `src/features/orders/OpenOrdersTable.tsx:45-52` (ячейка Size)
- Modify: `src/features/positions/TpSlDialog.tsx` (строка о размере)
- Test: `src/features/orders/__tests__/cappedSizes.test.ts` (новый), `e2e/tier1/28-position-actions.spec.ts`

**Interfaces:**
- Consumes: `positionBrackets(position, conditional)` и `Bracket.size`/`effectiveSize` (SDK 0.65.0, задача 1);
  `PositionRow.brackets` (задача 1).
- Produces: `cappedSizes(positions: readonly Pick<Position,'marketId'|'size'>[], conditional: readonly GatewayOrder[]): Map<string, bigint>`
  — `orderId` → действующий размер, только для скобок, у которых он меньше подписанного;
  `OrderRow.cappedSize?: bigint`.

Почему не переписываем ордер: он подписан пользователем; движок сам урезает reduce-only до позиции
(`reduce-only-reserve.ts:162` в monorepo). Экран должен показывать, что исполнится, а не что подписано.

- [ ] **Step 1: `cappedSizes` — тест**

```ts
import type { GatewayOrder } from "@liq/core";
import { describe, expect, it } from "vitest";

import { cappedSizes } from "../cappedSizes";

const WAD = 10n ** 18n;
const sl = (over: Partial<GatewayOrder> = {}): GatewayOrder =>
  ({
    id: "sl-1",
    accountId: "1",
    marketId: "200",
    sizeDelta: (-WAD).toString(),
    side: "SELL",
    orderType: "STOP_MARKET",
    status: "TRIGGER_PENDING",
    reduceOnly: true,
    limitPrice: null,
    triggerPrice: (60_000n * WAD).toString(),
    createdAt: "2026-10-06T00:00:00.000Z",
    groupId: null,
    ...over,
  }) as GatewayOrder;

describe("cappedSizes", () => {
  it("после частичного закрытия скобка урезана до позиции (TRM-21)", () => {
    const m = cappedSizes([{ marketId: 200n, size: WAD / 2n }], [sl()]);
    expect(m.get("sl-1")).toBe(WAD / 2n);
  });

  it("скобка не больше позиции — не урезана, в карте её нет", () => {
    expect(cappedSizes([{ marketId: 200n, size: WAD }], [sl()]).has("sl-1")).toBe(false);
  });

  it("нога без своей позиции (сирота) — не скобка, в карте её нет", () => {
    expect(cappedSizes([], [sl()]).size).toBe(0);
    expect(cappedSizes([{ marketId: 200n, size: -WAD }], [sl()]).size).toBe(0);
  });
});
```

Run: `rtk proxy pnpm vitest run src/features/orders/__tests__/cappedSizes.test.ts` — FAIL.

- [ ] **Step 2: `cappedSizes` — реализация**

```ts
import { type GatewayOrder, type Position, positionBrackets } from "@liq/core";

/**
 * Скобки, которые исполнятся меньшим размером, чем подписаны.
 *
 * @remarks После частичного закрытия TP/SL подписан на старый размер, а движок
 * урезает reduce-only до позиции. Экран показывает то, что исполнится (TRM-21).
 * Скобкой считается только нога своей позиции (SDK 0.65.0, `positionBrackets`).
 *
 * @returns `orderId` → действующий размер; только урезанные.
 */
export function cappedSizes(
  positions: readonly Pick<Position, "marketId" | "size">[],
  conditional: readonly GatewayOrder[],
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const position of positions) {
    const { takeProfit, stopLoss } = positionBrackets(position, conditional);
    for (const b of [takeProfit, stopLoss]) {
      if (b && b.effectiveSize < b.size) out.set(b.orderId, b.effectiveSize);
    }
  }
  return out;
}
```

(Если `positionBrackets`/`Position` экспортируются из `@liq/sdk`, а не `@liq/core`, — импорт оттуда, как в
`usePositionRows.ts`.)

Run: шаг 1 — PASS.

- [ ] **Step 3: Open Orders и диалог**

`useOpenOrderRows.ts`: взять позиции тем же хуком, что `usePositionRows` (`useEnrichedPositions(allMarketIds)`,
`allMarketIds` — из `useSelectedMarket()`), посчитать `const capped = useMemo(() => cappedSizes(positions, conditional), [positions, conditional]);`
и в строку — `cappedSize: capped.get(order.id),`. В `OrderRow`:

```ts
  /**
   * Сколько исполнит скобка, если меньше подписанного; `undefined` — не урезана.
   *
   * @remarks Движок урезает reduce-only до позиции; после частичного закрытия
   * подписанный размер больше того, что исполнится (TRM-21).
   */
  cappedSize?: bigint;
```

`OpenOrdersTable.tsx`, ячейка `size`:

```tsx
    cell: (info) => {
      const { order, cappedSize } = info.row.original;
      const size = parseWadLoose(order.sizeDelta);
      const signed = size < 0n ? -size : size;
      if (cappedSize === undefined) return formatQty(signed);
      return (
        <span
          data-testid="order-size-capped"
          title={`Signed for ${formatQty(signed)}; capped to position size`}
        >
          {formatQty(cappedSize)}{" "}
          <span className="text-muted text-xs">capped to position size</span>
        </span>
      );
    },
```

Аксессор сортировки колонки — по `cappedSize ?? |sizeDelta|`.

`TpSlDialog.tsx`: под полями (до строки валидации), если у текущей TP или SL `effectiveSize < size`:

```tsx
      {cappedLeg && (
        <p data-testid="tpsl-size-capped" className="text-muted text-xs">
          Closes {formatQty(cappedLeg.effectiveSize)} — capped to position size
          (signed for {formatQty(cappedLeg.size)}).
        </p>
      )}
```

где

```ts
  // Скобки исполняются не больше позиции: после частичного закрытия
  // подписанный размер больше — показываем, сколько закроется (TRM-21).
  const cappedLeg = [row.brackets.takeProfit, row.brackets.stopLoss].find(
    (b) => b !== null && b.effectiveSize < b.size,
  );
```

(`formatQty` — из `@liq/core`.)

Run: `rtk proxy pnpm typecheck && rtk proxy pnpm vitest run` — PASS.

- [ ] **Step 4: e2e**

В `28-position-actions.spec.ts`:

```ts
  test("a bracket bigger than the position shows the size it will close", async ({
    page,
    world,
  }) => {
    // TRM-21: после частичного закрытия SL подписан на 1.0, позиция — 0.5.
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture({ positionSize: WAD / 2n })];
      w.conditionalOrders = [conditionalOrderFixture({ id: "sl-1" })];
      return w;
    });

    await userInfo.selectTab("open-orders");
    const capped = userInfo.orderRow("sl-1").getByTestId("order-size-capped");
    await expect(capped).toBeVisible();
    await expect(capped).toContainText("0.5");

    await userInfo.selectTab("positions");
    await userInfo.editTpSl(MARKET.id).click();
    await expect(page.getByTestId("tpsl-size-capped")).toContainText("capped to position size");
  });
```

(`formatQty(WAD/2n)` может печатать `0.5000` — сравнивать с тем, что печатает SDK: `toContainText("0.5")` это
допускает.)

Run: `~/Work/perps/terminal/.worktrees/e2e-docker.sh` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src e2e
git commit -m "feat(orders): скобка показывает размер, который закроет, — не больше позиции (TRM-21)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
