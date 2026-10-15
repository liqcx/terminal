# Пакет TRM · terminal UI (TRM-16, 33, 18, 32, 26) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть в `terminal` пять багов TRM из ревизии бэклога 2026-10-14: вводящий в заблуждение текст про депозиты и «0x» (TRM-16), обрезанный на мобильном список рынков (TRM-33), экран входа на миг при перезагрузке (TRM-18), точность цены дешёвых рынков (TRM-32) и перезапись Quantity при смене плеча (TRM-26).

**Architecture:** Только фронт `terminal` поверх опубликованного `@liq/*` 0.68 — SDK, шлюз и контракты не меняются. Логика, которую можно проверить без браузера, выносится в чистые функции с unit-тестами (vitest, `environment: node`); видимое поведение закрепляется Playwright tier1 (hermetic, мок шлюза и цепочки).

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, Playwright, Tailwind 4, `@liq/core` / `@liq/react` / `@liq/sdk` 0.68 (npm `@liqpro/*`), `@turnkey/react-wallet-kit` 2.4, lightweight-charts 5, cmdk + Radix Popover.

**Spec:** отдельной спеки нет — спецификация это сами задачи и решения владельца в них (Plane, проект TRM, workspace liq-egn): TRM-16, TRM-33, TRM-18, TRM-32, TRM-26 (решение владельца «e» от 2026-10-06 в комментарии TRM-26). Выдержки, нужные исполнителю, перенесены в задачи ниже дословно.

## Global Constraints

- Репо `liqu-fi/terminal`, worktree `.worktrees/trm-ui-batch`, ветка `feat-cld/trm-ui-batch` от `origin/main` 8fce283; PR — draft в `main`.
- `@liq/*` не бампать и не менять: всё, чего нет в SDK 0.68, делается в терминале.
- Тексты интерфейса — по-английски; комментарии и TSDoc — по-русски, в стиле соседнего кода (объясняют «почему», а не «что»).
- Слово «LiqCx» нигде не писать (ни в коде, ни в коммитах, ни в PR).
- Unit-тесты: `src/**/__tests__/*.test.ts`, окружение `node` — только чистые функции, без рендера React. Поведение UI — Playwright tier1 в `e2e/tier1/*.spec.ts` (страницы-объекты в `e2e/pages/`, мир — `e2e/support/world.ts`).
- Ворота перед каждым коммитом: `pnpm typecheck && pnpm lint && pnpm test`; e2e — прогон спеки, которую задача трогала: `pnpm test:e2e e2e/tier1/<spec>`.
- Коммиты — conventional, тема по-русски, номер задачи в скобках: `fix(account): … (TRM-16)`. Хвост сообщения: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **TRM-26, единица USD.** Пользователь набрал Quantity в USD («500») и сменил плечо — в поле по-прежнему «500», процент слайдера пересчитан, размер в базе не изменился.
2. **TRM-26, пустой размер.** Плечо меняется при пустом Quantity — поле остаётся пустым, слайдер на 0 %, ничего не «заполняется».
3. **TRM-32, дорогие рынки не меняются.** BTC/ETH (цена ≥ 100) печатаются как раньше: не больше двух знаков, без обязательных копеек («69,900», «2,693.5»).
4. **TRM-18, Turnkey не поднялся.** Если загрузка конфигурации Turnkey падает (`clientState = Error`), пользователь видит экран входа, а не вечный «Loading account…».
5. **TRM-33, десктоп не меняется.** На ширине ≥ 696 px список рынков по-прежнему 680 px и без горизонтальной прокрутки.

---

### Task 1: TRM-16 — честная подпись «история недоступна» и плечо в одном формате

**Баг (TRM-16, дословно из задачи):** на Account → Overview в блоке «Recent activity» висит «Deposits and withdrawals are unavailable on this gateway», хотя Deposit и Withdraw работают — вывод проходил дважды. Там же «Account leverage» при нулевом плече печатается «0x», тогда как в остальном интерфейсе плечо с двумя знаками («0.00x», «0.50x»).

**Причина (триаж 2026-10-02 и ревизия 2026-10-14):** подпись ставится по `month?.available === false` — это ответ портфеля шлюза «сабграф недоступен» (`monorepo apps/order-gateway/src/portfolio/portfolio.service.ts`), то есть не прочитана **история** депозитов и выводов, а сами операции доступны. Та же подпись — во вкладке Transactions. «0x» — `fmtLeverage` в `src/lib/format.ts:31-33` режет до десятых и отбрасывает нули; карточка счёта (`AccountPanel.tsx:55-61`) печатает то же значение через `toFixed(2)` без «x».

**Files:**
- Modify: `src/lib/format.ts:30-33` (`fmtLeverage`), добавить константу подписи
- Modify: `src/features/account/OverviewTab.tsx:191-203` (подпись)
- Modify: `src/features/account/TransactionsTab.tsx:207-218` (подпись)
- Modify: `src/features/account/AccountPanel.tsx:1-5,54-61` (плечо через `fmtLeverage`)
- Test: `src/lib/__tests__/format.test.ts:34-37`
- Test: `e2e/tier1/30-account-page.spec.ts` (тест «портфель `available: false`…», около строк 115-142)

**Interfaces:**
- Produces: `export const EVENTS_UNAVAILABLE = "Deposit and withdrawal history is unavailable right now";` и `fmtLeverage(wad: bigint): string` — всегда два знака: `"0.00x"`, `"3.50x"`, `"10.00x"`.

- [ ] **Step 1: Переписать unit-тест `fmtLeverage` под новый формат (падающий)**

В `src/lib/__tests__/format.test.ts` заменить тест (строки 34-37):

```ts
  it("fmtLeverage: всегда два знака — как в карточке счёта и позициях", () => {
    expect(fmtLeverage(0n)).toBe("0.00x");
    expect(fmtLeverage(WAD / 2n)).toBe("0.50x");
    expect(fmtLeverage((35n * WAD) / 10n)).toBe("3.50x");
    expect(fmtLeverage(10n * WAD)).toBe("10.00x");
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm vitest run src/lib/__tests__/format.test.ts -t fmtLeverage`
Expected: FAIL — `expected '0x' to be '0.00x'`.

- [ ] **Step 3: Поправить `fmtLeverage` и завести подпись**

В `src/lib/format.ts` заменить строки 30-33:

```ts
/**
 * WAD-плечо: «0.00x», «3.50x», «10.00x» — всегда два знака.
 *
 * @remarks Одно написание на экран: карточка счёта и Overview печатали одно и
 * то же значение по-разному («0.00» и «0x», TRM-16).
 */
export function fmtLeverage(wad: bigint): string {
  return `${wadToNumber(wad).toFixed(2)}x`;
}

/**
 * Подпись при `available: false` у портфеля шлюза.
 *
 * @remarks Флаг значит «сабграф не ответил, история депозитов и выводов не
 * прочитана», а не «депозиты и выводы недоступны»: кнопки Deposit / Withdraw от
 * него не зависят и работают. Прежняя подпись читалась как запрет вывода (TRM-16).
 */
export const EVENTS_UNAVAILABLE =
  "Deposit and withdrawal history is unavailable right now";
```

- [ ] **Step 4: Unit-тест зелёный**

Run: `pnpm vitest run src/lib/__tests__/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Подставить подпись в Overview и Transactions**

`src/features/account/OverviewTab.tsx` — в импорт из `../../lib/format` добавить `EVENTS_UNAVAILABLE`; комментарий над блоком (строки 191-193) и текст (строка 201):

```tsx
          {/* Та же подпись, что во вкладке Transactions: `available: false`
              значит «история депозитов и выводов не прочитана», а не «их не
              было» и не «они недоступны», — строки леджера ниже рисуются как
              обычно, кнопки Deposit / Withdraw работают. */}
          {!activityPending &&
            !activityFailed &&
            month?.available === false && (
              <p
                className="text-xs text-muted"
                data-testid="recent-activity-events-unavailable"
              >
                {EVENTS_UNAVAILABLE}
              </p>
            )}
```

`src/features/account/TransactionsTab.tsx` — импортировать `EVENTS_UNAVAILABLE` из `../../lib/format` (добавить к существующему импорту оттуда, если он есть) и строку 216 заменить на `{EVENTS_UNAVAILABLE}`. Комментарий над блоком (строки 207-210) оставить по смыслу, заменив «события депозитов и выводов неизвестны» на «история депозитов и выводов не прочитана».

- [ ] **Step 6: Плечо в карточке счёта — тем же форматтером**

`src/features/account/AccountPanel.tsx`: импорт `wadToNumber` из `@liq/core` убрать, если больше не используется (оставить `formatUsd`); `fmtLeverage` добавить в импорт из `../../lib/format`; значение строки «Account Leverage»:

```tsx
          value={
            summary.leverage === undefined
              ? DASH
              : fmtLeverage(summary.leverage)
          }
```

- [ ] **Step 7: Закрепить подпись в e2e**

В `e2e/tier1/30-account-page.spec.ts`, в тесте, где портфель отвечает `available: false` (проверки `recent-activity-events-unavailable` и `transactions-events-unavailable`), после каждой `toBeVisible()` добавить проверку текста — он не должен утверждать, что депозиты и выводы недоступны:

```ts
    await expect(
      page.getByTestId("recent-activity-events-unavailable"),
    ).toHaveText("Deposit and withdrawal history is unavailable right now");
```

и то же для `transactions-events-unavailable`.

- [ ] **Step 8: Прогнать ворота и спеки**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e e2e/tier1/30-account-page.spec.ts e2e/tier1/24-account-panel.spec.ts`
Expected: всё зелёное. Если какая-то спека сверяет плечо старым написанием («0x», «10x», «0.50» без «x») — поправить ожидание на новый формат, не формат под тест.

- [ ] **Step 9: Commit**

```bash
git add src/lib/format.ts src/lib/__tests__/format.test.ts src/features/account/OverviewTab.tsx src/features/account/TransactionsTab.tsx src/features/account/AccountPanel.tsx e2e/tier1/30-account-page.spec.ts
git commit -m "fix(account): подпись «история недоступна» вместо «депозиты недоступны», плечо с двумя знаками (TRM-16)"
```

---

### Task 2: TRM-33 — список рынков помещается в мобильный экран

**Баг (TRM-33):** на мобильной ширине (360–440 px) выпадающий список выбора рынка шире экрана и обрезан справа без прокрутки: на 360 px видны только Pair и Last Price; Volume, Market Cap, звезда «Избранное» не видны ни на одном устройстве. Ожидается: список в ширину экрана, а таблица либо адаптируется, либо прокручивается по горизонтали; звезда и вкладки All / Favorites доступны.

**Причина:** `src/features/market/MarketSearch.tsx:100` — `PopoverContent className="w-[680px] p-0"`, жёсткая ширина; сетка строк (`GRID`, строка 29: `grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]`) без адаптивности, а корень `Command` (`src/components/ui/command.tsx:25`) — `overflow-hidden`, поэтому лишнее просто срезается.

**Решение:** ширина поповера — `min(680px, 100vw − 1rem)`; строка поиска с вкладками All / Favorites остаётся сверху во всю ширину; шапка колонок и список строк заворачиваются в один контейнер с `overflow-x-auto` и минимальной шириной таблицы 600 px — на узком экране таблица прокручивается вбок целиком (шапка едет вместе со строками), на десктопе прокрутки нет.

**Files:**
- Modify: `src/features/market/MarketSearch.tsx:97-198`
- Test: `e2e/tier1/25-market-search.spec.ts`

**Interfaces:**
- Produces: `data-testid="market-search-scroll"` — контейнер горизонтальной прокрутки (шапка колонок + `CommandList`).

- [ ] **Step 1: Написать падающие e2e-тесты**

В конец `e2e/tier1/25-market-search.spec.ts`, после последнего `test(...)` внутри `test.describe("market search", …)` и перед его закрывающей `});`, добавить:

```ts
  test("на десктопе список в прежнюю ширину и без прокрутки вбок", async ({
    page,
    world,
  }) => {
    const { market } = await enterTerminal(page, world, twoMarkets);
    await market.openSearch();

    const box = await market.search.boundingBox();
    expect(box?.width).toBeCloseTo(680, 0);
    const scroll = page.getByTestId("market-search-scroll");
    const overflows = await scroll.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test.describe("мобильная ширина 360px", () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test("список в пределах экрана, звезда и Favorites достижимы", async ({
      page,
      world,
    }) => {
      const { market } = await enterTerminal(page, world, twoMarkets);
      await market.openSearch();

      const box = await market.search.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);
      await expect(
        page.getByTestId("market-search-scope-favorites"),
      ).toBeInViewport();

      // Звезда — последняя колонка: доступна прокруткой таблицы вбок.
      await market.favoriteStar(MARKET_ETH.id).click();
      await page.getByTestId("market-search-scope-favorites").click();
      await expect(market.searchRows).toHaveCount(1);
      await expect(market.marketRow(MARKET_ETH.id)).toBeVisible();
    });
  });
```

(`market.search` — локатор поповера `market-search-popover`, `market.favoriteStar(id)` — `market-favorite-<id>`; оба уже есть в `e2e/pages/TerminalPanels.ts` — проверить имена там и использовать существующие.)

- [ ] **Step 2: Убедиться, что новые тесты падают**

Run: `pnpm test:e2e e2e/tier1/25-market-search.spec.ts`
Expected: оба новых теста FAIL — у первого нет `market-search-scroll`, у второго правый край поповера > 360.

- [ ] **Step 3: Ограничить ширину и завернуть таблицу в прокрутку**

В `src/features/market/MarketSearch.tsx`:

1. Рядом с `GRID` (строка 29) добавить комментарий и константу минимальной ширины:

```tsx
/**
 * Минимальная ширина таблицы рынков.
 *
 * @remarks Шесть колонок не сжимаются в 360 px телефона без потери смысла, а
 * обрезка прятала Change, Volume и звезду совсем (TRM-33). Ниже этой ширины
 * таблица прокручивается вбок целиком — шапка вместе со строками.
 */
const TABLE_MIN_W = "min-w-[600px]";
```

2. `PopoverContent` (строки 97-101):

```tsx
      <PopoverContent
        align="start"
        className="w-[min(680px,calc(100vw-1rem))] p-0"
        data-testid="market-search-popover"
      >
```

3. Шапку колонок (`<div className={`${GRID} border-b …`}>…</div>`, строки 130-139) и `<CommandList>…</CommandList>` (строки 140-197) обернуть в один контейнер; строку поиска с All / Favorites (строки 103-129) не трогать:

```tsx
          <div
            className="overflow-x-auto"
            data-testid="market-search-scroll"
          >
            <div className={TABLE_MIN_W}>
              <div
                className={`${GRID} border-b border-border px-3 py-1 text-[10px] text-muted`}
              >
                {/* …шапка колонок без изменений… */}
              </div>
              <CommandList>
                {/* …строки без изменений… */}
              </CommandList>
            </div>
          </div>
```

- [ ] **Step 4: e2e зелёный**

Run: `pnpm test:e2e e2e/tier1/25-market-search.spec.ts e2e/tier1/19-layout.spec.ts e2e/tier1/29-layout-containment.spec.ts`
Expected: PASS, включая старые тесты поиска (поиск, выбор, избранное после перезагрузки).

- [ ] **Step 5: Ворота и commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

```bash
git add src/features/market/MarketSearch.tsx e2e/tier1/25-market-search.spec.ts
git commit -m "fix(market): список рынков в ширину экрана, таблица прокручивается вбок на мобильном (TRM-33)"
```

---

### Task 3: TRM-18 — лоадер, пока Turnkey восстанавливает сессию

**Баг (TRM-18):** при перезагрузке страницы с живой сессией на миг (на 3G — 4–5 с) показывается экран «Continue with email», затем сам сменяется на «Loading account…» и терминал. В Network в это окно ещё не ответили `get_user`, `list_wallets`, `list_wallet_accounts`. Ожидается нейтральный лоадер, пока проверка сессии не закончена; экран входа — только когда отсутствие сессии подтверждено.

**Причина (ревизия 2026-10-14, по коду `@turnkey/react-wallet-kit` 2.4.2):** `authState` у кита стартует с `Unauthenticated`, а `clientState` — `undefined` → `"loading"` (пока идут `initializeSessions()`: `get_user`, `list_wallets`…) → `"ready"` или `"error"` (`dist/providers/client/Provider.mjs`: `useState()` для `clientState`, `setClientState(ClientState.Loading)` при создании клиента, `setClientState(ClientState.Ready)` в `initializeSessions().finally`, `setClientState(ClientState.Error)` при сбое загрузки конфигурации или клиента). Терминал `clientState` не читает: `subOrgId` в `TurnkeyIdentityProvider.tsx:86-97` равен `null`, пока `authState !== Authenticated`, поэтому `TurnkeyBootGate` (`SessionGate.tsx:39-49`) пропускает, wagmi не переподключается, `useSessionStage()` = `"disconnected"` → `SignInPanel` с «Continue with email».

**Решение:** провайдер личности отдаёт флаг `restoring` — «кит ещё не закончил восстановление» (`clientState` не `"ready"` и не `"error"`); `TurnkeyBootGate` держит «Loading account…», пока `restoring`, и, как раньше, пока восстановленная личность разрешает встроенный кошелёк. `"error"` снимает лоадер — пользователь видит вход, а не вечную загрузку. Решение о лоадере — чистой функцией, по образцу `identityReset.ts`.

Hermetic e2e это не покрывает: там `VITE_E2E_WALLET=true` и `TurnkeyBootGate` не монтируется (`turnkeyLoginEnabled === false`). Поэтому — unit-тесты предиката и договора провайдера; живая проверка — тестировщиком при ретесте (F5 с 3G-троттлингом).

**Files:**
- Create: `src/features/auth/bootGate.ts`
- Create: `src/features/auth/__tests__/bootGate.test.ts`
- Modify: `src/features/auth/TurnkeyIdentityProvider.tsx` (тип `TurnkeyIdentityValue`, чтение `clientState`, `value`)
- Modify: `src/features/auth/SessionGate.tsx:26-49` (`TurnkeyBootGate`)
- Test: `src/features/auth/__tests__/turnkeyIdentity.test.ts` (мок `useTurnkey` получает `clientState`)

**Interfaces:**
- Produces (в `bootGate.ts`):
  - `export function turnkeyRestoring(clientState: string | undefined): boolean` — `true`, пока `clientState` не `"ready"` и не `"error"`.
  - `export function bootGateLoading(input: { restoring: boolean; subOrgId: string | null; embedded: "idle" | "resolving" | "ready" | "failed" }): boolean`.
- Produces (в `TurnkeyIdentityValue`): поле `restoring: boolean`.

- [ ] **Step 1: Написать падающий unit-тест предикатов**

Создать `src/features/auth/__tests__/bootGate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { bootGateLoading, turnkeyRestoring } from "../bootGate";

describe("turnkeyRestoring", () => {
  it("до создания клиента и во время восстановления сессий — восстанавливается", () => {
    expect(turnkeyRestoring(undefined)).toBe(true);
    expect(turnkeyRestoring("loading")).toBe(true);
  });

  it("ready и error — восстановление закончено", () => {
    expect(turnkeyRestoring("ready")).toBe(false);
    // Сбой конфигурации или клиента не держит лоадер вечно: вход должен быть виден.
    expect(turnkeyRestoring("error")).toBe(false);
  });
});

describe("bootGateLoading", () => {
  it("пока кит восстанавливает сессию — лоадер, даже без личности", () => {
    expect(
      bootGateLoading({ restoring: true, subOrgId: null, embedded: "idle" }),
    ).toBe(true);
  });

  it("сессии нет и кит готов — пропускает к экрану входа", () => {
    expect(
      bootGateLoading({ restoring: false, subOrgId: null, embedded: "idle" }),
    ).toBe(false);
  });

  it("личность есть, кошелёк ещё разрешается — лоадер", () => {
    for (const embedded of ["idle", "resolving"] as const) {
      expect(
        bootGateLoading({ restoring: false, subOrgId: "sub-1", embedded }),
      ).toBe(true);
    }
  });

  it("кошелёк разрешён или разрешение упало — пропускает", () => {
    for (const embedded of ["ready", "failed"] as const) {
      expect(
        bootGateLoading({ restoring: false, subOrgId: "sub-1", embedded }),
      ).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm vitest run src/features/auth/__tests__/bootGate.test.ts`
Expected: FAIL — модуль `../bootGate` не найден.

- [ ] **Step 3: Реализовать `bootGate.ts`**

Создать `src/features/auth/bootGate.ts`:

```ts
/**
 * Восстанавливает ли кит Turnkey сессию прямо сейчас.
 *
 * @remarks
 * `clientState` кита идёт `undefined` → `"loading"` → `"ready"` | `"error"`:
 * `undefined` — конфигурация ещё грузится, `"loading"` — клиент создан и
 * читает сохранённую сессию (`get_user`, `list_wallets`…). Всё это время
 * `authState` уже `Unauthenticated`, и без этого флага гейт рисовал экран входа
 * поверх живой сессии (TRM-18). `"error"` — восстановление закончено неудачей:
 * лоадер снимается, иначе сбой конфигурации запирал бы пользователя в
 * «Loading account…» навсегда.
 *
 * Строки, а не `ClientState` кита: перечисление не реэкспортируется ни
 * `@liq/react`, ни корнем `@turnkey/react-wallet-kit`.
 */
export function turnkeyRestoring(clientState: string | undefined): boolean {
  return clientState !== "ready" && clientState !== "error";
}

/**
 * Держать ли «Loading account…» вместо гейта сессии.
 *
 * @remarks Два окна, в которые экран входа соврал бы: кит ещё не восстановил
 * сессию (`restoring`) и восстановленная личность ещё не получила встроенный
 * кошелёк (`subOrgId` есть, кошелёк `idle` / `resolving`) — второе окно гейт
 * закрывал и раньше.
 */
export function bootGateLoading(input: {
  restoring: boolean;
  subOrgId: string | null;
  embedded: "idle" | "resolving" | "ready" | "failed";
}): boolean {
  if (input.restoring) return true;
  return (
    input.subOrgId !== null &&
    (input.embedded === "idle" || input.embedded === "resolving")
  );
}
```

- [ ] **Step 4: Unit-тест зелёный**

Run: `pnpm vitest run src/features/auth/__tests__/bootGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Провайдер личности отдаёт `restoring`**

В `src/features/auth/TurnkeyIdentityProvider.tsx`:

1. В тип `TurnkeyIdentityValue` добавить поле (после `embedded`):

```ts
  /**
   * Кит Turnkey ещё восстанавливает сохранённую сессию: `subOrgId === null`
   * в это окно не значит «не вошли» (см. `turnkeyRestoring`).
   */
  restoring: boolean;
```

2. Импорт: `import { turnkeyRestoring } from "./bootGate";`
3. Деструктуризация: `const { authState, session, clientState } = useTurnkey();`
4. В `useMemo` значения: вычислить `const restoring = turnkeyRestoring(clientState);` и вернуть `{ subOrgId, embedded: embeddedView, restoring, retryResolve: … }`; добавить `clientState` в зависимости `useMemo`.

- [ ] **Step 6: Договор провайдера в существующем тесте**

В `src/features/auth/__tests__/turnkeyIdentity.test.ts` мок `turnkey` (строка ~33: `let turnkey = { authState: "authenticated", session: { organizationId: "sub-1" } };`) дополнить полем `clientState: "ready" as string | undefined` — остальные тесты описывают уже восстановленную сессию. Если в файле есть `beforeEach`, который пересобирает `turnkey`, добавить поле и туда. Добавить тест в стиле соседних (через тот же рендер-хелпер, которым они читают `seen.value`):

```ts
  it("пока кит восстанавливает сессию, личность помечена restoring", async () => {
    turnkey = { authState: "unauthenticated", session: undefined, clientState: "loading" };
    await render();
    expect(seen.value?.subOrgId).toBeNull();
    expect(seen.value?.restoring).toBe(true);

    turnkey = { authState: "authenticated", session: { organizationId: "sub-1" }, clientState: "ready" };
    await render();
    expect(seen.value?.restoring).toBe(false);
  });
```

(Имя рендер-хелпера и форму перерендера взять из соседних тестов файла — не изобретать новый; если тип `turnkey` выведен литералом, расширить его так, чтобы `session` мог быть `undefined`.)

- [ ] **Step 7: Гейт держит лоадер по предикату**

В `src/features/auth/SessionGate.tsx` заменить тело `TurnkeyBootGate` (строки 39-49) и дополнить его TSDoc (строки 26-38) абзацем про первое окно:

```tsx
/**
 * Перехватывает гейт, пока сессия Turnkey не восстановлена или восстановленная
 * личность ещё не получила встроенный кошелёк.
 *
 * @remarks
 * Первое окно — кит читает сохранённую сессию (`get_user`, `list_wallets`):
 * `authState` в это время уже `Unauthenticated`, и `SessionGateInner` рисовал
 * «Continue with email» поверх живой сессии — на 3G по 4–5 секунд (TRM-18).
 *
 * Второе — штатное восстановление wagmi заканчивается мгновенно: `isAuthorized()`
 * коннектора Turnkey зовёт `getProvider()` по пустому в этот тик реестру
 * провайдеров, а лестнице ещё только предстоит круг к auth-proxy и
 * `resolve-signer`.
 */
function TurnkeyBootGate({ children }: { children: ReactNode }) {
  const { subOrgId, embedded, restoring } = useTurnkeyIdentity();
  if (bootGateLoading({ restoring, subOrgId, embedded: embedded.kind })) {
    return (
      <Centered testid="session-loading">
        <p className="text-muted">Loading account…</p>
      </Centered>
    );
  }
  return <>{children}</>;
}
```

Импорт: `import { bootGateLoading } from "./bootGate";`.

- [ ] **Step 8: Ворота**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e e2e/tier1/01-onboarding.spec.ts e2e/tier1/15-session-persistence.spec.ts`
Expected: PASS (e2e не задевается — подтверждение, что гейт кошелька e2e не сломан).

- [ ] **Step 9: Commit**

```bash
git add src/features/auth/bootGate.ts src/features/auth/__tests__/bootGate.test.ts src/features/auth/TurnkeyIdentityProvider.tsx src/features/auth/SessionGate.tsx src/features/auth/__tests__/turnkeyIdentity.test.ts
git commit -m "fix(auth): «Loading account…», пока Turnkey восстанавливает сессию, а не экран входа (TRM-18)"
```

---

### Task 4: TRM-32 — точность цены по величине цены, а не два знака на всё

**Баг (TRM-32):** на XRP-PERP (≈ $1.50) все цены округлены до 0.01: шапка «$1.5», Mark «1.5», Entry «1.5» при фактических 1.5015, Trade History «1.5», шкала графика с шагом 0.02; поле Order Price не даёт ввести больше двух знаков (1.4123 → 1.41). Шаг 0.01 — около 0.67 % цены. На ETH (~2,700) и SOL (~119) двух знаков хватает.

**Причина (ревизия 2026-10-14):** точности рынка в метаданных нет (`MarketSummary` SDK 0.68 — без `tickSize` / `priceDecimals`; задача на это в MR заводится отдельно, вне плана). Терминал везде берёт 2 знака:
- отображение — `fmtPrice` (`src/lib/format.ts:16-18`) зовёт `formatPrice` SDK, у которого `maxDecimals: 2` по умолчанию; `TradesTape.tsx:123` зовёт `formatPrice` напрямую;
- ввод — `LIMIT_PRICE_DECIMALS = 2` (`TradeForm.tsx:62`, применяется в строках 119, 397, 401), `maxDecimals={2}` у TP/SL в `EntryTpSlFields.tsx:39,51` и `positions/TpSlDialog.tsx:132,143`;
- график — `CandleChart.tsx:82` создаёт серию без `priceFormat`, у lightweight-charts по умолчанию `precision: 2, minMove: 0.01`.

**Решение (быстрый фикс на стороне терминала):** число знаков выводится из величины цены функцией SDK `suggestDecimalsFor` (`@liq/core`: ≥ 100 → 2, ≥ 10 → 3, ≥ 0.1 → 4, ≥ 0.01 → 5, …), но **не меньше двух** — дорогие рынки печатаются как раньше (у `suggestDecimalsFor` для ≥ 100 000 — 0 знаков, это поменяло бы BTC). Для отображения — по самому значению; для ввода и графика — по марку рынка. Копейки по-прежнему не обязательны («69,900», «1.5015»).

**Files:**
- Modify: `src/lib/format.ts:12-18` (`priceDecimals`, `fmtPrice`)
- Modify: `src/features/orderbook/TradesTape.tsx:123`
- Modify: `src/features/trade/TradeForm.tsx:55-62,113-121,392-402` (десятичные поля цены — по марку)
- Modify: `src/features/trade/EntryTpSlFields.tsx` (проп `priceDecimals`)
- Modify: `src/features/positions/TpSlDialog.tsx:128-145`
- Modify: `src/features/chart/CandleChart.tsx` (эффект `priceFormat` по последнему бару)
- Test: `src/lib/__tests__/format.test.ts`
- Test: `e2e/tier1/05-trade-limit.spec.ts`

**Interfaces:**
- Produces (в `src/lib/format.ts`):
  - `export function priceDecimals(price: bigint): number` — `max(2, suggestDecimalsFor(|price| / 1e18))`; для `0n` — 2.
  - `fmtPrice(v: bigint): string` — до `priceDecimals(v)` знаков, без обязательных нулей.
  - `export function chartPriceFormat(price: number): { type: "price"; precision: number; minMove: number }`.
- Consumes: `suggestDecimalsFor`, `wadToNumber`, `formatPrice` из `@liq/core`.

- [ ] **Step 1: Написать падающие unit-тесты**

В `src/lib/__tests__/format.test.ts` добавить `priceDecimals`, `chartPriceFormat` в импорт из `../format` и тесты:

```ts
  it("priceDecimals: не меньше двух, мелкой цене — больше", () => {
    expect(priceDecimals(0n)).toBe(2);
    expect(priceDecimals(112_345n * WAD)).toBe(2); // BTC — как раньше, не 0
    expect(priceDecimals(2_693n * WAD)).toBe(2); // ETH
    expect(priceDecimals(119n * WAD)).toBe(2); // SOL
    expect(priceDecimals(15n * WAD)).toBe(3);
    expect(priceDecimals((15_015n * WAD) / 10_000n)).toBe(4); // XRP 1.5015
    expect(priceDecimals((-15_015n * WAD) / 10_000n)).toBe(4); // знак не важен
  });

  it("fmtPrice: XRP с четырьмя знаками, дорогие рынки — как раньше", () => {
    expect(fmtPrice((15_015n * WAD) / 10_000n)).toBe("1.5015");
    expect(fmtPrice((15n * WAD) / 10n)).toBe("1.5");
    expect(fmtPrice(69_900n * WAD)).toBe("69,900");
    expect(fmtPrice((26_935n * WAD) / 10n)).toBe("2,693.5");
  });

  it("chartPriceFormat: точность и шаг шкалы по цене", () => {
    expect(chartPriceFormat(1.5015)).toEqual({
      type: "price",
      precision: 4,
      minMove: 0.0001,
    });
    expect(chartPriceFormat(2693.5)).toEqual({
      type: "price",
      precision: 2,
      minMove: 0.01,
    });
  });
```

Если в файле уже есть тест `fmtPrice` со старыми ожиданиями — оставить его, он должен остаться зелёным (дорогие цены не меняются); если он закрепляет «1.5» для 1.5015 — исправить ожидание на «1.5015».

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run src/lib/__tests__/format.test.ts`
Expected: FAIL — `priceDecimals` / `chartPriceFormat` не экспортируются; `fmtPrice(1.5015)` даёт «1.5».

- [ ] **Step 3: Реализовать в `src/lib/format.ts`**

Импорт `@liq/core` дополнить `suggestDecimalsFor`. Заменить `fmtPrice` (строки 12-18):

```ts
/**
 * Знаков после запятой у цены — по её величине, но не меньше двух.
 *
 * @remarks Шага цены у рынка нет нигде в контуре (`MarketSummary` без
 * `tickSize`), поэтому точность выводится из самой цены: два знака на XRP
 * (≈ $1.50) — это шаг ≈ 0.67 %, Entry 1.5015 печатался «1.5» (TRM-32). Пол в два
 * знака держит дорогие рынки как были: `suggestDecimalsFor` для ≥ 100 000
 * отдаёт ноль, и BTC потерял бы центы.
 */
export function priceDecimals(price: bigint): number {
  const abs = price < 0n ? -price : price;
  return Math.max(2, suggestDecimalsFor(wadToNumber(abs)));
}

/**
 * Цена в таблицах и шапке: без `$` (валюту называет заголовок колонки) и без
 * обязательных копеек — «69,900», «1.5015», а не «$69,900.00».
 */
export function fmtPrice(v: bigint): string {
  return formatPrice(v, {
    sign: "",
    minDecimals: 0,
    maxDecimals: priceDecimals(v),
  });
}

/**
 * Формат цены серии lightweight-charts по цене рынка.
 *
 * @remarks По умолчанию у серии `precision: 2, minMove: 0.01` — на XRP шкала
 * шла шагом 0.02 и метка текущей цены была «1.50» (TRM-32).
 */
export function chartPriceFormat(price: number): {
  type: "price";
  precision: number;
  minMove: number;
} {
  const precision = Math.max(2, suggestDecimalsFor(Math.abs(price)));
  return { type: "price", precision, minMove: 10 ** -precision };
}
```

Проверить, что `minMove` для 4 знаков ровно `0.0001` (`10 ** -4 === 0.0001` в JS — `true`); если тест упадёт на плавающей точке — `Number((10 ** -precision).toFixed(precision))`.

- [ ] **Step 4: Unit-тесты зелёные**

Run: `pnpm vitest run src/lib/__tests__/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Лента сделок — тем же форматтером**

`src/features/orderbook/TradesTape.tsx:123`: `formatPrice(row.price, { sign: "" })` → `fmtPrice(row.price)` (импорт из `../../lib/format`; импорт `formatPrice` из `@liq/core` убрать, если больше не используется).

- [ ] **Step 6: Поля цены тикета — по марку рынка**

В `src/features/trade/TradeForm.tsx`:

1. Константу `LIMIT_PRICE_DECIMALS` (строки 55-62) удалить вместе с её TSDoc.
2. После `const markPrice = useMarkPrice();` добавить:

```ts
  // Знаков в полях цены — по марку рынка (TRM-32). Одно число на три места:
  // поле лимитной цены, мост из книги и кнопку MID; разойдясь, они дадут поле,
  // молча отбрасывающее то, что мост в него положил.
  const priceInputDecimals = priceDecimals(markPrice);
```

(`priceDecimals` — импорт из `../../lib/format`.)

3. Подписка на стор книги (строки 113-121) читает число через ref, потому что эффект подписывается один раз (`[]`): завести `const priceInputDecimalsRef = useRef(priceInputDecimals); priceInputDecimalsRef.current = priceInputDecimals;` рядом с объявлением и в подписке звать `sanitizeDecimal(Price.fmt(s.limitPrice), priceInputDecimalsRef.current)`. (`useRef` добавить в импорт из `react`.)
4. `onMid` и `maxDecimals` поля Order Price (строки 392-402): `LIMIT_PRICE_DECIMALS` → `priceInputDecimals`.
5. `<EntryTpSlFields … />` — передать `priceDecimals={priceInputDecimals}`.

- [ ] **Step 7: TP/SL — тем же правилом**

`src/features/trade/EntryTpSlFields.tsx`: в пропсы добавить

```ts
  /** Знаков в полях цены — по марку рынка (TRM-32). */
  priceDecimals: number;
```

и оба `maxDecimals={2}` (строки 39, 51) заменить на `maxDecimals={priceDecimals}`.

`src/features/positions/TpSlDialog.tsx`: в теле компонента `const decimals = priceDecimals(row.markPrice ?? 0n);` (импорт из `../../lib/format`), оба `maxDecimals={2}` (строки 132, 143) → `maxDecimals={decimals}`.

- [ ] **Step 8: Шкала графика — по последнему бару**

В `src/features/chart/CandleChart.tsx` после эффекта заливки данных добавить эффект:

```tsx
  // Точность шкалы — по цене рынка (TRM-32): у серии по умолчанию два знака.
  // Отдельным эффектом и только при смене числа знаков — иначе `applyOptions`
  // шёл бы на каждом тике последнего бара.
  const lastClose = bars.at(-1)?.close;
  const precision =
    lastClose === undefined ? undefined : chartPriceFormat(lastClose).precision;
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || lastClose === undefined) return;
    series.applyOptions({ priceFormat: chartPriceFormat(lastClose) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт только по смене точности
  }, [precision]);
```

(`chartPriceFormat` — импорт из `../../lib/format`. Если линтер проекта настроен иначе и директива не нужна или запрещена — переписать без неё: хранить `lastClose` в ref и держать в зависимостях только `precision`.)

- [ ] **Step 9: Написать e2e на дешёвый рынок**

В `e2e/tier1/05-trade-limit.spec.ts` добавить тест (импорт `readyWorld` из `../support/world` и `WAD` из `../support/constants`, если их ещё нет):

```ts
  test("на дешёвом рынке цена вводится и печатается с четырьмя знаками", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () =>
      readyWorld({ price: (15_015n * WAD) / 10_000n }),
    );

    await expect(page.getByTestId("market-mark-price")).toHaveText("1.5015");

    await trade.selectTab("limit");
    await trade.setSize("10");
    await trade.setLimitPrice("1.4123");
    await expect(trade.limitPriceInput).toHaveValue("1.4123");
    await trade.submit();

    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(0);
    expect(world.submittedOrders.at(-1)!.limitPrice).toBe(
      Price.parse("1.4123").toString(),
    );
  });
```

Имена `market-mark-price` и `trade.limitPriceInput` — проверить по `src/features/market/MarketHeader.tsx` и `e2e/pages/TerminalPanels.ts` и взять существующие (если у Mark в шапке нет `data-testid` — добавить `data-testid="market-mark-price"` на ячейку `MarketHeader.tsx:69`). Если `readyWorld` не принимает `price` напрямую — посмотреть, как соседние спеки задают марк (`priceByMarket` / мутация `world` после `readyWorld`), и сделать так же.

- [ ] **Step 10: e2e и ворота**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e e2e/tier1/05-trade-limit.spec.ts e2e/tier1/02-market-data.spec.ts e2e/tier1/20-orderbook.spec.ts e2e/tier1/21-trades-tape.spec.ts e2e/tier1/08-positions.spec.ts e2e/tier1/28-position-actions.spec.ts e2e/tier1/10-history.spec.ts e2e/tier1/23-history-tables.spec.ts`
Expected: PASS. Спеки с дорогими рынками (BTC 70 000) не должны поменять ни одного ожидания; если какая-то закрепляла цену с двумя знаками на цене < 100 — разобраться, верно ли новое написание по правилу `priceDecimals`, и поправить ожидание.

- [ ] **Step 11: Commit**

```bash
git add src/lib/format.ts src/lib/__tests__/format.test.ts src/features/orderbook/TradesTape.tsx src/features/trade/TradeForm.tsx src/features/trade/EntryTpSlFields.tsx src/features/positions/TpSlDialog.tsx src/features/chart/CandleChart.tsx src/features/market/MarketHeader.tsx e2e/tier1/05-trade-limit.spec.ts
git commit -m "fix(price): точность цены по её величине — XRP с четырьмя знаками в таблицах, полях и графике (TRM-32)"
```

---

### Task 5: TRM-26 — Quantity первична: смена плеча не трогает размер

**Баг (TRM-26):** введённое руками значение Quantity молча перезаписывается при смене плеча — пересчитывается из округлённого процента слайдера: 0.3 ETH на 2x → на 5x стало 0.761, после возврата на 2x — 0.3044; исходное значение теряется.

**Решение владельца «e» (2026-10-06, комментарий в TRM-26), дословно:** «первична Quantity. Введённое руками количество не меняется при смене плеча, пересчитывается только процент. Если новое плечо не позволяет такой размер, поле подсвечивается, но само не урезается.»

**Причина:** `src/features/trade/useOrderSizing.ts:315-327` — `setLeverage` при непустом размере переписывает `sizeStr` из `pct` (`pctToSize(pct, nextMax)`), а `pct` — целое, округлённое в `setSizeStr` (строка 305: `sizeToPct` округляет до процента). TSDoc хука (строки 98-109) закрепляет старый замысел «changing leverage rescales the size to preserve pct».

**Решение:** `setLeverage` меняет только плечо и пересчитывает `pct` от неизменного размера против нового потолка; строка размера (в любой единице, base или USD) не трогается. Правило одно для размера, набранного руками и выставленного слайдером: первична Quantity. Размер выше потолка покупательной способности (`sizeQty > maxSize`) подсвечивает поле (`invalid`), но не урезается и не блокирует подачу — допуск по марже решают шлюз и протокол, а у тикета для этого уже есть предупреждение (`validation.warn`).

**Files:**
- Create: `src/features/trade/sizingRules.ts`
- Create: `src/features/trade/__tests__/sizingRules.test.ts`
- Modify: `src/features/trade/useOrderSizing.ts:45-79` (тип `OrderSizing`), `:98-109` (TSDoc), `:315-327` (`setLeverage`), `:338-361` (возврат)
- Modify: `src/features/trade/TradeForm.tsx` (проп `invalid` у `QuantityField`)
- Test: `e2e/tier1/07-trade-gating.spec.ts`

**Interfaces:**
- Produces (в `sizingRules.ts`): `export function exceedsBuyingPower(sizeQty: bigint, maxSize: bigint): boolean` — `true`, только если потолок известен (`maxSize > 0n`) и размер его превышает.
- Produces (в `OrderSizing`): поле `exceedsMax: boolean`.
- Consumes: `sizeFromLeverage`, `sizeToPct`, `Qty`, `Usd`, `Price` из `@liq/sdk` (уже импортированы в хуке).

- [ ] **Step 1: Написать падающий unit-тест правила**

Создать `src/features/trade/__tests__/sizingRules.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { exceedsBuyingPower } from "../sizingRules";

const WAD = 10n ** 18n;

describe("exceedsBuyingPower", () => {
  it("размер в пределах потолка — не превышает", () => {
    expect(exceedsBuyingPower(WAD, 2n * WAD)).toBe(false);
    expect(exceedsBuyingPower(2n * WAD, 2n * WAD)).toBe(false);
  });

  it("размер выше потолка — превышает", () => {
    expect(exceedsBuyingPower(3n * WAD, 2n * WAD)).toBe(true);
  });

  it("потолок неизвестен (0n: нет марка или маржи) — не судит", () => {
    // Нулевой потолок — «посчитать нечем», а не «можно ноль»: отсутствие
    // маржи тикет показывает своей строкой, подсветка поля его не дублирует.
    expect(exceedsBuyingPower(WAD, 0n)).toBe(false);
  });

  it("пустой размер — не превышает", () => {
    expect(exceedsBuyingPower(0n, 2n * WAD)).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm vitest run src/features/trade/__tests__/sizingRules.test.ts`
Expected: FAIL — модуль `../sizingRules` не найден.

- [ ] **Step 3: Реализовать правило**

Создать `src/features/trade/sizingRules.ts`:

```ts
/**
 * Превышает ли размер потолок покупательной способности при текущем плече.
 *
 * @remarks Только подсветка поля, не урезание и не запрет подачи: по решению
 * владельца (TRM-26, «e») Quantity первична, и смена плеча размер не трогает.
 * Нулевой потолок значит «посчитать нечем» (нет марка или маржи) — тогда
 * правило молчит: отсутствие маржи тикет показывает своей строкой.
 */
export function exceedsBuyingPower(sizeQty: bigint, maxSize: bigint): boolean {
  return maxSize > 0n && sizeQty > maxSize;
}
```

- [ ] **Step 4: Unit-тест зелёный**

Run: `pnpm vitest run src/features/trade/__tests__/sizingRules.test.ts`
Expected: PASS.

- [ ] **Step 5: Написать падающий e2e**

В `e2e/tier1/07-trade-gating.spec.ts` добавить `describe` (импорты `enterTerminal`, `expect`, `test` в файле уже есть — проверить):

```ts
test.describe("смена плеча не трогает размер (TRM-26)", () => {
  test("введённая Quantity остаётся, пересчитывается только процент", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    await trade.setLeverage(2);
    await trade.setSize("0.3");
    const pctAt2 = await trade.sizePctValue.textContent();

    await trade.setLeverage(5);
    await expect(trade.sizeInput).toHaveValue("0.3");
    await expect(trade.sizePctValue).not.toHaveText(pctAt2 ?? "");

    await trade.setLeverage(2);
    await expect(trade.sizeInput).toHaveValue("0.3");
    await expect(trade.sizePctValue).toHaveText(pctAt2 ?? "");
  });

  test("размер выше потолка нового плеча подсвечен, но не урезан", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    await trade.setLeverage(10);
    await trade.setSizePct(100);
    const full = await trade.sizeInput.inputValue();
    await expect(trade.sizeInput).not.toHaveAttribute("aria-invalid", "true");

    await trade.setLeverage(2);
    await expect(trade.sizeInput).toHaveValue(full);
    await expect(trade.sizeInput).toHaveAttribute("aria-invalid", "true");
    await expect(trade.sizePctValue).toHaveText("100%");
  });

  test("в USD набранная сумма тоже не меняется", async ({ page, world }) => {
    const { trade } = await enterTerminal(page, world);
    await trade.setSizeUnit("usd");
    await trade.setSize("500");

    await trade.setLeverage(5);
    await expect(trade.sizeInput).toHaveValue("500");
  });

  test("пустой размер плечо не заполняет", async ({ page, world }) => {
    const { trade } = await enterTerminal(page, world);
    await trade.setLeverage(5);
    await expect(trade.sizeInput).toHaveValue("");
    await expect(trade.sizePctValue).toHaveText("0%");
  });
});
```

Плечи 2 / 5 / 10 должны быть в списке `leverage-option-*` рынка по умолчанию (BTC, потолок 25×) — сверить с `src/features/trade/leverageSteps.ts`; если какого-то нет, взять соседнее допустимое. Если хелперы страницы называются иначе (`sizePctValue`, `setSizePct`, `setSizeUnit`) — взять имена из `e2e/pages/TerminalPanels.ts`.

- [ ] **Step 6: Убедиться, что e2e падает**

Run: `pnpm test:e2e e2e/tier1/07-trade-gating.spec.ts -g "TRM-26"`
Expected: FAIL — после `setLeverage(5)` в поле не «0.3»; во втором тесте после `setLeverage(2)` размер урезан, а не подсвечен.

- [ ] **Step 7: Переписать `setLeverage` и TSDoc хука**

В `src/features/trade/useOrderSizing.ts`:

1. TSDoc хука (строки 98-109) — заменить предложение про плечо:

```ts
/**
 * Interlinked order-sizing state for the trade ticket.
 *
 * Two pieces of state: the size string (in the active {@link SizeUnit} — the
 * authoritative order quantity) and `pct` (the slice of buying power — the
 * slider position). Quantity is primary (owner decision «e», TRM-26): typing a
 * size re-derives `pct`; choosing a `pct` rewrites the size; changing leverage
 * keeps the size exactly as it is and re-derives `pct` against the new
 * buying-power ceiling. A size above the new ceiling is flagged
 * (`exceedsMax`), never trimmed. Leverage never *fills* an empty size (the
 * ticket's Margin and Liq. Price are the protocol's, from the contract preview).
 */
```

2. `setLeverage` (строки 315-327):

```ts
  // Quantity первична (TRM-26, решение «e»): плечо меняет только потолок, а
  // размер остаётся тем, что набрал пользователь, — в любой единице. Процент
  // слайдера пересчитывается от неизменного размера; пустой размер пустым и
  // остаётся. Раньше размер переписывался из целого процента, и 0.3 после
  // 2x → 5x → 2x становилось 0.3044.
  function setLeverage(l: number) {
    setLeverageRaw(l);
    const nextMax = sizeFromLeverage({
      availableUsd: Usd(available),
      leverage: l,
      markPrice: Price(sizePrice),
    });
    setPctRaw(sizeToPct(Qty(sizeQty), nextMax));
  }
```

3. В тип `OrderSizing` (после `maxSize`) добавить:

```ts
  /**
   * Размер выше потолка покупательной способности при текущем плече —
   * подсветка поля, не урезание (TRM-26).
   */
  exceedsMax: boolean;
```

4. Импорт `import { exceedsBuyingPower } from "./sizingRules";` и в объект возврата — `exceedsMax: exceedsBuyingPower(sizeQty, maxSize),`.

- [ ] **Step 8: Подсветка поля в тикете**

`src/features/trade/TradeForm.tsx`, `<QuantityField …>`: `invalid={rejection !== undefined}` → `invalid={rejection !== undefined || sizing.exceedsMax}`.

- [ ] **Step 9: e2e и ворота**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e e2e/tier1/07-trade-gating.spec.ts e2e/tier1/04-trade-market.spec.ts e2e/tier1/05-trade-limit.spec.ts e2e/tier1/22-ticket-flags.spec.ts`
Expected: PASS. Если старый тест закреплял пересчёт размера при смене плеча (старый замысел «preserve pct») — это и есть отменённое владельцем поведение: переписать его ожидание на новое правило и упомянуть в отчёте, какой тест и почему.

- [ ] **Step 10: Commit**

```bash
git add src/features/trade/sizingRules.ts src/features/trade/__tests__/sizingRules.test.ts src/features/trade/useOrderSizing.ts src/features/trade/TradeForm.tsx e2e/tier1/07-trade-gating.spec.ts
git commit -m "fix(trade): смена плеча не трогает Quantity — пересчитывается процент, превышение подсвечено (TRM-26)"
```
