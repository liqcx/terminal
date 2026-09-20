# Проверка цен скобок в терминале: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Терминал не даёт подать скобку, чей триггер на опорной цене уже выполнен: тикет гасит кнопку стороны и объясняет причину до входа, диалог позиции гасит Save и показывает причину и предупреждение о ликвидации; оба вызывающих передают действию марк.

**Architecture:** Правило живёт в SDK 0.57.0 (`validateBrackets` + `describeBracketRejection` / `describeBracketWarning` из `@liq/sdk`), терминал его только зовёт и печатает. Тикет судит **результирующую** позицию отдельно для каждой кнопки (`открытая + вход этой стороной`) — расчёт один на гейт и на подачу, чтобы гейт и `attachBrackets` не разошлись. Диалог судит строку позиции, у которой марк и цена ликвидации уже есть.

**Tech Stack:** React 19, Vite, TypeScript, vitest (юниты только на чистые функции, `environment: node`, `src/**/*.test.ts`), Playwright (tier-1 против мока шлюза), pnpm + moon.

**Spec:** `docs/superpowers/specs/2026-09-18-bracket-price-check-design.md`

**Предшественник:** SDK-PR liqcx/monorepo#790 смержен в `staging` (`aa8977aa`), тег `liq@0.57.0` запушен. Спека SDK-части: `monorepo/docs/superpowers/specs/2026-09-18-bracket-price-check-design.md`, её заметки — в `monorepo/docs/superpowers/plans/2026-09-18-bracket-price-check.md` § «Notes for next phase».

## Global Constraints

- **Предусловие задачи 1:** `npm view @liqpro/liq-core version` показывает `0.57.0`. На момент написания плана в npm `0.56.0`: джоба `npm` в `publish-liq-packages.yml` падает с `E404 PUT` (токен без прав на scope `@liqpro`), половина `@liqcx` в GitHub Packages опубликована. Публикует владелец. Пока версии нет — задачу 1 не начинать, `pnpm install` подтянет старую и уронит типы.
- Ветка `feat-cld/bracket-price-check` уже создана в основном чекауте `/Users/alex/Work/perps/terminal` и несёт коммит спеки. Worktree не заводить: репозиторий один, параллельных прогонов нет. Проверять ветку перед каждым коммитом (`git branch --show-current`).
- Вывод `pnpm`/`moon` с кириллицей роняет хук rtk — запускать через `rtk proxy <команда>`; при подозрительном коде возврата повторить сырым бинарём.
- Коммитить только явно перечисленные файлы (`git add <файлы>`), никогда `git add -A`. Каждый коммит завершается строкой `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Pre-commit хук обязателен — `--no-verify` не использовать.
- Prettier: двойные кавычки, точки с запятой, 2 пробела (конфиг репозитория). Комментарии — TSDoc на русском, как у соседей (`TpSlDialog.tsx`, `SubmitButtons.tsx`); комментарий объясняет, какую поломку он ловит, а не пересказывает код. Названия тестов — английские, как у соседних спеков; комментарии внутри — русские.
- Контракт `data-testid` — инвариант: добавлять можно, переименовывать нельзя. Новые: `entry-tpsl-validation`, `tpsl-validation`, `tpsl-warning`.
- Макет Frame-12/13 — контракт: надписи кнопок Buy / Sell не меняются, ни одна колонка и ни один флаг не убираются (решение в TSDoc `SubmitButtons.tsx`).
- Гейты: `rtk proxy pnpm typecheck`, `rtk proxy pnpm lint`, `rtk proxy pnpm test`, `rtk proxy pnpm build`; e2e — `rtk proxy pnpm test:e2e` (tier-1, порт задаётся `E2E_PORT`, первый прогон прогревает vite — см. `docs/`). Полный набор гейтов — в конце каждой задачи, где менялся код.
- Словарь: **Скобки** (TP и SL позиции), **нога**, **связка** (`groupId`), **опорная цена** (марк; у лимитного входа без открытой позиции — ещё и цена входа), **результирующая позиция** (`открытая + вход`). Не «bracket order», не «TP/SL-ордер».
- Правило из SDK не переписывать и не дублировать: терминал зовёт `validateBrackets` и печатает `describeBracketRejection` / `describeBracketWarning` как есть. Имя ноги уже внутри текста (`Take profit: must be above mark`).
- Судится только включённое: тумблер TP/SL погашен или оба поля пусты — вердикта нет, кнопки живут по общему гейту.
- Известный пробел, закрывать в этом плане не нужно: в tier-1 мок отдаёт `getRequiredMargins` нулями, поэтому `EnrichedPosition.liquidationPrice` равна `ZERO_PRICE`, и предупреждение «SL за ликвидацией» e2e показать не может. Оно покрыто юнитами SDK; в терминале остаётся непокрытым сознательно.
- Исполнение по HARD RULE workspace: `plan-state init docs/superpowers/plans/2026-09-20-bracket-price-check.md` до задачи 1; каждый implementer получает `REQUIRED SKILL: implement-task`, каждый reviewer — `REQUIRED SKILL: review-task`.
- План коммитится контроллером **до задачи 1**, отдельным коммитом: `git add docs/superpowers/plans/2026-09-20-bracket-price-check.md` → `docs(trade): план проверки цен скобок`.
- Один draft-PR в `main` (`gh pr create --draft`) в задаче 3, не раньше.

## Карта файлов

| файл                                                             | ответственность                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `package.json`                                                   | `@liq/*` `^0.57.0`                                                                                |
| `src/features/trade/resultingPosition.ts` (новый)                | позиция, которой станет рынок после входа стороной                                                |
| `src/features/trade/__tests__/resultingPosition.test.ts` (новый) | сложение размеров и знак стороны                                                                  |
| `src/features/trade/TradeForm.tsx`                               | вердикт на сторону, раздельный `disabled`, строка под полями, `markPrice` / `entryPrice` в подаче |
| `src/features/trade/SubmitButtons.tsx`                           | `disabled` по сторонам                                                                            |
| `src/features/trade/EntryTpSlFields.tsx`                         | строка `entry-tpsl-validation` под полями                                                         |
| `src/features/positions/TpSlDialog.tsx`                          | вердикт строки, Save по вердикту, строки `tpsl-validation` и `tpsl-warning`, `markPrice` в подаче |
| `e2e/pages/TerminalPanels.ts`                                    | `entryTpslValidation`, `tpslValidation`, `tpslWarning`                                            |
| `e2e/tier1/04-trade-market.spec.ts`                              | гейт тикета: одна сторона, обе стороны, лимитный вход                                             |
| `e2e/tier1/28-position-actions.spec.ts`                          | гейт диалога                                                                                      |

---

### Task 1: Бамп 0.57.0, марк у обоих вызывающих, `resultingPosition`

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/features/trade/resultingPosition.ts`
- Create: `src/features/trade/__tests__/resultingPosition.test.ts`
- Modify: `src/features/trade/TradeForm.tsx:161-175`
- Modify: `src/features/positions/TpSlDialog.tsx:54-66`

**Interfaces:**

- Consumes (SDK 0.57.0, из `@liq/sdk`): `ApplyBracketsInput` с обязательным `markPrice: Price` и необязательным `entryPrice?: Price` (`0n` — «нет»).
- Produces (нужно задачам 2 и 3):

```ts
export function resultingPosition(
  marketId: bigint,
  open: { size: bigint; side: Side } | undefined,
  entryDelta: Qty,
): { marketId: bigint; side: Side; size: Qty };
```

- [ ] **Step 1: Проверить, что версия опубликована**

Run: `npm view @liqpro/liq-core version`
Expected: `0.57.0`. Если `0.56.0` — остановиться и сказать владельцу: задача заблокирована публикацией.

- [ ] **Step 2: Бамп**

```bash
# Якорь — `@^` и закрывающая кавычка: под него попадают только пять строк
# `npm:@liqpro/liq-*@^0.56.0"`, а не любая другая зависимость этой версии.
sed -i '' 's/@\^0\.56\.0"/@^0.57.0"/g' package.json
grep -E '"@liq/' package.json
```

Expected: пять строк с `^0.57.0` (`api-client`, `core`, `react`, `sdk`, `turnkey`); ни одной с `0.56.0`.

Run: `rtk proxy pnpm install`
Expected: установка без ошибок; `pnpm-lock.yaml` изменён.

- [ ] **Step 3: Убедиться, что типы красные**

Run: `rtk proxy pnpm typecheck`
Expected: FAIL — два места без `markPrice` в `ApplyBracketsInput` (`TradeForm.tsx`, `TpSlDialog.tsx`). Это и есть страховка SDK: забыть проверку нельзя.

- [ ] **Step 4: Написать падающий тест `resultingPosition`**

Создать `src/features/trade/__tests__/resultingPosition.test.ts`:

```ts
import { Qty, Side } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import { resultingPosition } from "../resultingPosition";

const WAD = 10n ** 18n;
const MARKET = 200n;

describe("resultingPosition", () => {
  it("без открытой позиции даёт сторону входа", () => {
    expect(resultingPosition(MARKET, undefined, Qty(WAD))).toEqual({
      marketId: MARKET,
      side: Side.BUY,
      size: Qty(WAD),
    });
    expect(resultingPosition(MARKET, undefined, Qty(-WAD))).toEqual({
      marketId: MARKET,
      side: Side.SELL,
      size: Qty(-WAD),
    });
  });

  it("долив складывается с открытой позицией", () => {
    const open = { size: 2n * WAD, side: Side.BUY };
    expect(resultingPosition(MARKET, open, Qty(WAD)).size).toBe(Qty(3n * WAD));
  });

  it("частичное закрытие сохраняет сторону открытой позиции", () => {
    // Лонг 2, продажа 1 — рынок остаётся длинным, и скобки принадлежат лонгу.
    // Сторона кнопки здесь солгала бы: у Sell скобки судились бы как у шорта.
    const open = { size: 2n * WAD, side: Side.BUY };
    expect(resultingPosition(MARKET, open, Qty(-WAD))).toEqual({
      marketId: MARKET,
      side: Side.BUY,
      size: Qty(WAD),
    });
  });

  it("переворот меняет сторону", () => {
    const open = { size: WAD, side: Side.BUY };
    expect(resultingPosition(MARKET, open, Qty(-3n * WAD))).toEqual({
      marketId: MARKET,
      side: Side.SELL,
      size: Qty(-2n * WAD),
    });
  });

  it("полное закрытие даёт нулевой размер", () => {
    // Ног у такой позиции нет; вердикт по ней пуст — это решает SDK.
    const open = { size: WAD, side: Side.BUY };
    expect(resultingPosition(MARKET, open, Qty(-WAD)).size).toBe(Qty(0n));
  });

  it("размер открытой позиции по модулю приводится знаком стороны", () => {
    // Часть источников несёт размер без знака: короткая позиция с size = +1
    // без `toSignedSize` сложилась бы как длинная.
    const open = { size: WAD, side: Side.SELL };
    expect(resultingPosition(MARKET, open, Qty(WAD)).size).toBe(Qty(0n));
  });
});
```

- [ ] **Step 5: Убедиться, что тест падает**

Run: `rtk proxy pnpm test -- resultingPosition`
Expected: FAIL — `Failed to resolve import "../resultingPosition"`.

- [ ] **Step 6: Написать `resultingPosition` и позвать её из обоих мест**

Создать `src/features/trade/resultingPosition.ts`:

```ts
import { Qty, Side, toSignedSize } from "@liq/sdk";

/**
 * Позиция, которой станет рынок после входа этой стороной.
 *
 * @remarks Скобки ставятся на позицию, а не на вход: у лонга 2 и продажи 1
 * рынок остаётся длинным, и TP по-прежнему обязан стоять выше цены. Сторона
 * нажатой кнопки здесь лжёт — считать надо результат.
 *
 * Один расчёт на гейт кнопок и на подачу: разойдясь, они дали бы активную
 * кнопку, чьи скобки действие тут же отклонит — уже после принятого входа.
 *
 * Знак приводит `toSignedSize`: часть источников несёт размер по модулю.
 * Нулевой размер (полное закрытие) — не особый случай: ног у такой позиции
 * нет, и `validateBrackets` отвечает пустым вердиктом.
 */
export function resultingPosition(
  marketId: bigint,
  open: { size: bigint; side: Side } | undefined,
  entryDelta: Qty,
): { marketId: bigint; side: Side; size: Qty } {
  const size = Qty(
    (open ? toSignedSize(open.size, open.side) : 0n) + entryDelta,
  );
  return { marketId, side: size < 0n ? Side.SELL : Side.BUY, size };
}
```

В `src/features/trade/TradeForm.tsx` тело `attachBrackets` (строки 161–175) заменить на:

```tsx
function attachBrackets(entryDelta: Qty) {
  if (!tpslOn || accountId === undefined || marketId === undefined) return;
  // `mutate`, как и вход: отказ приходит в `applyBrackets.error` и печатается
  // строкой `trade-error`.
  applyBrackets.mutate({
    position: resultingPosition(marketId, openPosition, entryDelta),
    brackets: positionBrackets(marketId, conditional),
    takeProfit: Price(parseOrZero(Price.parse, tp)),
    stopLoss: Price(parseOrZero(Price.parse, sl)),
    // Тот же марк, по которому судит гейт: к этому моменту цена могла уйти,
    // и тогда действие отклонит ногу — законный отказ, он виден в
    // `trade-error` с именем ноги.
    markPrice: Price(markPrice),
    entryPrice,
  });
}
```

Выше по файлу, сразу после `const tabPriceReady = ...` (строка 134), добавить:

```tsx
const openPosition = positions.find((p) => p.marketId === marketId);
/**
 * Вторая опорная цена — только у лимитного входа без открытой позиции.
 *
 * @remarks Стоп между лимитной ценой и марком сгорел бы раньше, чем вход
 * исполнится, и по связке снял бы тейк. Когда позиция уже открыта, скобки
 * принадлежат ей, и опорная цена одна: стоп живой позиции законно стоит по
 * эту сторону от ещё не сработавшего лимита.
 */
const entryPrice =
  tab === "Limit" && openPosition === undefined
    ? Price(parsedTabPrice())
    : undefined;
```

Импорты: добавить `resultingPosition` из `./resultingPosition`; строку `const open = positions.find(...)` внутри `attachBrackets` удалить (её заменил `openPosition`).

В `src/features/positions/TpSlDialog.tsx` в вызов `applyBrackets.mutate` (строки 55–63) добавить последним полем:

```tsx
        // Марк строки: по нему же судит гейт Save ниже.
        markPrice: Price(row.markPrice ?? 0n),
```

- [ ] **Step 7: Убедиться, что тест и типы зелёные**

Run: `rtk proxy pnpm test -- resultingPosition`
Expected: PASS, 6 тестов.

Run: `rtk proxy pnpm typecheck && rtk proxy pnpm lint`
Expected: обе команды — код 0.

- [ ] **Step 8: Прогнать e2e, которые уже покрывают скобки**

Run: `rtk proxy pnpm test:e2e -- 04-trade-market 28-position-actions`
Expected: PASS — поведение не менялось, менялся только вход действия. Существующие фикстуры годны по цене: марк 70 000, TP 80 000/90 000/95 000 выше, SL 60 000 ниже.

- [ ] **Step 9: Commit**

```bash
rtk proxy pnpm exec prettier --write src/features/trade/resultingPosition.ts src/features/trade/__tests__/resultingPosition.test.ts src/features/trade/TradeForm.tsx src/features/positions/TpSlDialog.tsx
git add package.json pnpm-lock.yaml src/features/trade/resultingPosition.ts src/features/trade/__tests__/resultingPosition.test.ts src/features/trade/TradeForm.tsx src/features/positions/TpSlDialog.tsx
git commit -m "$(cat <<'EOF'
chore(deps): SDK 0.57.0 — марк уходит в действие скобок, результирующая позиция одним расчётом

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Гейт тикета — своя кнопка на сторону и строка причины

**Files:**

- Modify: `src/features/trade/TradeForm.tsx`
- Modify: `src/features/trade/SubmitButtons.tsx`
- Modify: `src/features/trade/EntryTpSlFields.tsx`
- Modify: `e2e/pages/TerminalPanels.ts:88-128` (поля панели тикета)
- Modify: `e2e/tier1/04-trade-market.spec.ts`

**Interfaces:**

- Consumes (задача 1): `resultingPosition(marketId, open, entryDelta)`; из `@liq/sdk` — `validateBrackets`, `describeBracketRejection`, тип `BracketsVerdict`.
- Produces (нужно задаче 3): в page object панели тикета — `entryTpslValidation: Locator` (`entry-tpsl-validation`).

- [ ] **Step 1: Написать падающие e2e**

В `e2e/tier1/04-trade-market.spec.ts` в конец `test.describe("market orders", …)` добавить:

```ts
test("a take-profit on the wrong side of mark blocks that side only", async ({
  page,
  world,
}) => {
  const { trade } = await enterTerminal(page, world);

  await trade.setSize("0.5");
  await trade.tpslToggle.click();
  // Марк фикстуры — 70 000. Тейк ниже него у длинной сработал бы на первом
  // тике и закрыл бы её по рынку; короткой такой тейк годится.
  await trade.entryTpInput.fill("60000");

  await expect(trade.submitBuy).toBeDisabled();
  await expect(trade.submitSell).toBeEnabled();
  await expect(trade.entryTpslValidation).toHaveText("TP/SL fit a short only");
});

test("brackets that fit neither side block both buttons and name both reasons", async ({
  page,
  world,
}) => {
  const { trade } = await enterTerminal(page, world);

  await trade.setSize("0.5");
  await trade.tpslToggle.click();
  // Тейк и стоп на одном уровне ниже марка: длинной не годится тейк,
  // короткой — стоп. Подавать такое нечем, и кнопка об этом говорит.
  await trade.entryTpInput.fill("60000");
  await trade.entrySlInput.fill("60000");

  await expect(trade.submitBuy).toBeDisabled();
  await expect(trade.submitSell).toBeDisabled();
  await expect(trade.entryTpslValidation).toContainText(
    "Long — Take profit: must be above mark",
  );
  await expect(trade.entryTpslValidation).toContainText(
    "Short — Stop loss: must be above mark",
  );
  expect(world.submittedOrders).toHaveLength(0);
});

test("a limit entry judges brackets against the entry price too", async ({
  page,
  world,
}) => {
  const { trade } = await enterTerminal(page, world);

  await trade.selectTab("limit");
  await trade.setLimitPrice("65000");
  await trade.setSize("0.5");
  await trade.tpslToggle.click();
  // Ниже марка (70 000), но выше лимита (65 000): цена дойдёт до стопа
  // раньше, чем до входа, — он сгорит до позиции и снимет тейк по связке.
  await trade.entrySlInput.fill("67000");

  await expect(trade.submitBuy).toBeDisabled();
  await expect(trade.entryTpslValidation).toContainText(
    "must be below entry price",
  );
});

test("an open position drops the entry-price reference", async ({
  page,
  world,
}) => {
  const { trade } = await enterTerminal(page, world, () => {
    const w = readyWorld();
    w.accounts[0].positions = [longPositionFixture()];
    return w;
  });

  await trade.selectTab("limit");
  await trade.setLimitPrice("65000");
  await trade.setSize("0.5");
  await trade.tpslToggle.click();
  // Тот же стоп, что запрещён выше: у живой длинной позиции он законен —
  // скобки принадлежат ей, а не ещё не сработавшему лимиту.
  await trade.entrySlInput.fill("67000");

  await expect(trade.submitBuy).toBeEnabled();
  await expect(trade.entryTpslValidation).toBeHidden();
});
```

В `e2e/pages/TerminalPanels.ts` в панель тикета добавить поле рядом с `entrySlInput`:

```ts
  readonly entryTpslValidation: Locator;
```

и в конструкторе, следом за `this.entrySlInput = …`:

```ts
this.entryTpslValidation = page.getByTestId("entry-tpsl-validation");
```

- [ ] **Step 2: Убедиться, что e2e падают**

Run: `rtk proxy pnpm test:e2e -- 04-trade-market`
Expected: FAIL — четыре новых теста; кнопки активны, строки `entry-tpsl-validation` нет. Старые тесты спека зелёные.

- [ ] **Step 3: Вердикт на сторону в тикете**

В `src/features/trade/TradeForm.tsx` импорт из `@liq/sdk` дополнить:

```tsx
import {
  acceptablePrice,
  type BracketsVerdict,
  Bps,
  describeBracketRejection,
  describeRejection,
  describeWarning,
  positionBrackets,
  Price,
  Qty,
  Side,
  validateBrackets,
} from "@liq/sdk";
```

(`toSignedSize` из импорта уходит — он переехал в `resultingPosition`.)

После блока `entryPrice` из задачи 1 добавить:

```tsx
const tpPrice = Price(parseOrZero(Price.parse, tp));
const slPrice = Price(parseOrZero(Price.parse, sl));
const brackets =
  marketId === undefined
    ? NO_BRACKETS
    : positionBrackets(marketId, conditional);
// Скобки судятся, только когда их собираются поставить: погашенный тумблер и
// два пустых поля — это «скобок нет», а не «скобки плохие».
const bracketsOn = tpslOn && (tpPrice > 0n || slPrice > 0n);

/**
 * Годятся ли скобки позиции, которой станет рынок после входа этой стороной.
 *
 * @remarks Сторон две, и вердикт у них разный: тейк ниже цены запрещён
 * длинной и нормален короткой. Поэтому судится каждая кнопка отдельно, а не
 * «тикет целиком».
 *
 * Судит экран, а не только действие SDK: скобки входа подаются после того,
 * как шлюз принял вход, и отказ там оставил бы позицию без стопа.
 */
function verdictFor(side: Side): BracketsVerdict | null {
  if (!bracketsOn || marketId === undefined) return null;
  return validateBrackets({
    position: resultingPosition(
      marketId,
      openPosition,
      side === Side.BUY
        ? sizing.summary.long.sizeDelta
        : sizing.summary.short.sizeDelta,
    ),
    brackets,
    takeProfit: tpPrice,
    stopLoss: slPrice,
    markPrice: Price(markPrice),
    entryPrice,
  });
}

const longVerdict = verdictFor(Side.BUY);
const shortVerdict = verdictFor(Side.SELL);
const longOk = longVerdict?.ok !== false;
const shortOk = shortVerdict?.ok !== false;

/** Отказы одной стороны одной строкой; пусто — сторона годна или судить нечем. */
function legsOf(label: string, verdict: BracketsVerdict | null): string {
  const legs = [
    describeBracketRejection(verdict?.takeProfit ?? null),
    describeBracketRejection(verdict?.stopLoss ?? null),
  ]
    .filter((t) => t !== undefined)
    .join(" · ");
  return legs === "" ? "" : `${label} — ${legs}`;
}

/**
 * Одна строка под полями TP/SL.
 *
 * @remarks Три состояния: скобки годятся обеим кнопкам — молчим; годятся
 * одной — приглушённая подсказка, какой именно (она объясняет, почему вторая
 * кнопка погасла); ни одной — причина по каждой стороне.
 *
 * Текста может не быть и при отказе: `not-ready` (марка ещё нет) молчит
 * намеренно, как `describeRejection` у ордера. Пустую красную строку в этом
 * случае не рисуем — кнопки уже погашены общим гейтом.
 */
function bracketsNote(): { text: string; bad: boolean } | null {
  if (longOk && shortOk) return null;
  if (longOk || shortOk) {
    return {
      text: `TP/SL fit a ${longOk ? "long" : "short"} only`,
      bad: false,
    };
  }
  const text = [legsOf("Long", longVerdict), legsOf("Short", shortVerdict)]
    .filter((t) => t !== "")
    .join(" · ");
  return text === "" ? null : { text, bad: true };
}
```

Рядом с `EMPTY_POSITIONS` (строка 62) добавить стабильную пустышку:

```tsx
/** Скобок нет — пока рынок не выбран. Стабильная ссылка: литерал гонял бы мемо. */
const NO_BRACKETS = { takeProfit: null, stopLoss: null };
```

В `attachBrackets` из задачи 1 заменить `brackets: positionBrackets(marketId, conditional),` на `brackets,` — теперь это одно значение на гейт и на подачу.

Вызов `SubmitButtons` заменить на:

```tsx
<SubmitButtons
  onSubmit={submit}
  buyDisabled={disabled || !longOk}
  sellDisabled={disabled || !shortOk}
/>
```

Вызов `EntryTpSlFields` заменить на:

```tsx
<EntryTpSlFields
  enabled={tpslOn}
  tp={tp}
  setTp={setTp}
  sl={sl}
  setSl={setSl}
  note={bracketsNote()}
/>
```

- [ ] **Step 4: Кнопки и строка**

В `src/features/trade/SubmitButtons.tsx` заменить пропсы и оба `disabled`:

```tsx
/**
 * Две кнопки подачи — сторона выбирается нажатием, а не хранится в тикете.
 *
 * @remarks Надписи постоянны: макет не показывает ни смены текста, ни причины
 * отказа на самой кнопке. Причина живёт строкой ниже, кнопка при отказе просто
 * неактивна — иначе одно и то же место экрана было бы то призывом к действию,
 * то объяснением, почему действие невозможно.
 *
 * Гасятся кнопки порознь: скобки входа годятся одной стороне и запрещены
 * другой (тейк ниже цены нормален короткой позиции и закрыл бы длинную сразу),
 * и общий флаг отнял бы у пользователя законную сторону.
 */
export function SubmitButtons({
  onSubmit,
  buyDisabled,
  sellDisabled,
}: {
  onSubmit: (side: Side) => void;
  buyDisabled: boolean;
  sellDisabled: boolean;
}) {
```

и в разметке — `disabled={buyDisabled}` у Buy / Long, `disabled={sellDisabled}` у Sell / Short. Проп `pending` уходит: он уже входит в общий гейт вызывающего, и второй раз его складывать незачем.

В `src/features/trade/EntryTpSlFields.tsx` добавить проп и строку:

```tsx
export function EntryTpSlFields({
  enabled,
  tp,
  setTp,
  sl,
  setSl,
  note,
}: {
  enabled: boolean;
  tp: string;
  setTp: (v: string) => void;
  sl: string;
  setSl: (v: string) => void;
  /** Что сказать под полями: подсказка о стороне или причина отказа. */
  note: { text: string; bad: boolean } | null;
}) {
```

и последним элементом внутри `<div … data-testid="tpsl-fields">`, после блока Stop loss:

```tsx
{
  note && (
    <p
      className={note.bad ? "text-[10px] text-short" : "text-[10px] text-muted"}
      data-testid="entry-tpsl-validation"
    >
      {note.text}
    </p>
  );
}
```

- [ ] **Step 5: Убедиться, что e2e проходят**

Run: `rtk proxy pnpm test:e2e -- 04-trade-market`
Expected: PASS — весь спек, включая четыре новых теста.

- [ ] **Step 6: Гейты**

Run: `rtk proxy pnpm typecheck && rtk proxy pnpm lint && rtk proxy pnpm test && rtk proxy pnpm build`
Expected: все четыре — код 0.

- [ ] **Step 7: Commit**

```bash
rtk proxy pnpm exec prettier --write src/features/trade/TradeForm.tsx src/features/trade/SubmitButtons.tsx src/features/trade/EntryTpSlFields.tsx e2e/pages/TerminalPanels.ts e2e/tier1/04-trade-market.spec.ts
git add src/features/trade/TradeForm.tsx src/features/trade/SubmitButtons.tsx src/features/trade/EntryTpSlFields.tsx e2e/pages/TerminalPanels.ts e2e/tier1/04-trade-market.spec.ts
git commit -m "$(cat <<'EOF'
feat(trade): скобки входа судятся до подачи — кнопка стороны гаснет и называет причину

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Гейт диалога позиции, PR

**Files:**

- Modify: `src/features/positions/TpSlDialog.tsx`
- Modify: `e2e/pages/TerminalPanels.ts:310-335` (панель `UserInfoPanel`)
- Modify: `e2e/tier1/28-position-actions.spec.ts`

**Interfaces:**

- Consumes (задачи 1–2): `markPrice` в подаче диалога; из `@liq/sdk` — `validateBrackets`, `describeBracketRejection`, `describeBracketWarning`.
- Produces: ветка на `origin`; draft-PR в `main`.

- [ ] **Step 1: Написать падающие e2e**

В `e2e/tier1/28-position-actions.spec.ts` после теста про отказ шлюза добавить:

```ts
test("a take-profit below mark blocks Save and names the reason", async ({
  page,
  world,
}) => {
  const { userInfo } = await enterTerminal(page, world, () => {
    const w = readyWorld();
    w.accounts[0].positions = [longPositionFixture()];
    return w;
  });

  await userInfo.selectTab("positions");
  await userInfo.editTpSl(MARKET.id).click();
  // Марк 70 000: такой тейк у длинной сработал бы сразу и закрыл бы её.
  await userInfo.tpslTp.fill("60000");

  await expect(userInfo.tpslSave).toBeDisabled();
  await expect(userInfo.tpslValidation).toHaveText(
    "Take profit: must be above mark",
  );
  expect(world.submittedOrders).toHaveLength(0);
});

test("a bracket on the right side of mark still saves", async ({
  page,
  world,
}) => {
  const { userInfo } = await enterTerminal(page, world, () => {
    const w = readyWorld();
    w.accounts[0].positions = [longPositionFixture()];
    return w;
  });

  await userInfo.selectTab("positions");
  await userInfo.editTpSl(MARKET.id).click();
  // Гейт не должен запирать законную правку: тейк выше марка подаётся.
  await userInfo.tpslTp.fill("95000");

  await expect(userInfo.tpslValidation).toBeHidden();
  await userInfo.tpslSave.click();
  await expect.poll(() => world.submittedOrders.length).toBe(1);
});
```

В `e2e/pages/TerminalPanels.ts` в `UserInfoPanel` рядом с геттером `tpslError` добавить:

```ts
  get tpslValidation(): Locator {
    return this.page.getByTestId("tpsl-validation");
  }
  get tpslWarning(): Locator {
    return this.page.getByTestId("tpsl-warning");
  }
```

- [ ] **Step 2: Убедиться, что e2e падают**

Run: `rtk proxy pnpm test:e2e -- 28-position-actions`
Expected: FAIL — первый новый тест (Save активна, строки нет). Второй новый и старые — зелёные.

- [ ] **Step 3: Вердикт в диалоге**

В `src/features/positions/TpSlDialog.tsx` импорт из `@liq/sdk` заменить на:

```tsx
import {
  describeBracketRejection,
  describeBracketWarning,
  Price,
  validateBrackets,
} from "@liq/sdk";
```

Перед `function save()` добавить:

```tsx
const tpPrice = Price(parseOrZero(Price.parse, tp));
const slPrice = Price(parseOrZero(Price.parse, sl));
// Марк строки живой: таблица обновляет его вместе с ценами, и вердикт
// пересчитывается — скобка, законная минуту назад, гаснет вместе с ценой.
const verdict = validateBrackets({
  position: row.position,
  brackets: row.brackets,
  takeProfit: tpPrice,
  stopLoss: slPrice,
  markPrice: Price(row.markPrice ?? 0n),
  liquidationPrice: row.position.liquidationPrice,
});
const rejection = [
  describeBracketRejection(verdict.takeProfit),
  describeBracketRejection(verdict.stopLoss),
]
  .filter((t) => t !== undefined)
  .join(" · ");
const warning = describeBracketWarning(verdict.warn);
```

В `save()` заменить два вычисления цен на уже посчитанные:

```tsx
function save() {
  applyBrackets.mutate(
    {
      position: row.position,
      brackets: row.brackets,
      // Пустое поле — `0n`, то есть «снять».
      takeProfit: tpPrice,
      stopLoss: slPrice,
      markPrice: Price(row.markPrice ?? 0n),
    },
    { onSuccess: () => onClose() },
  );
}
```

После абзаца `Empty field removes the bracket…` и перед блоком `tpsl-error` добавить:

```tsx
{
  rejection !== "" && (
    <p className="mt-2 text-[11px] text-short" data-testid="tpsl-validation">
      {rejection}
    </p>
  );
}

{
  warning && (
    <p className="mt-2 text-[11px] text-muted" data-testid="tpsl-warning">
      {warning}
    </p>
  );
}
```

Кнопку Save погасить вердиктом:

```tsx
            disabled={
              applyBrackets.isPending || accountId === undefined || !verdict.ok
            }
```

В TSDoc компонента добавить абзац:

```tsx
 * Отказ проверки и отказ шлюза стоят разными строками: `tpsl-validation` —
 * «не отправили», `tpsl-error` — «отправили, и шлюз отказал». Смешав их, экран
 * сказал бы, что заявка ушла, хотя на провод ничего не уходило.
```

- [ ] **Step 4: Убедиться, что e2e проходят**

Run: `rtk proxy pnpm test:e2e -- 28-position-actions`
Expected: PASS — весь спек.

- [ ] **Step 5: Полный набор гейтов**

Run: `rtk proxy pnpm typecheck && rtk proxy pnpm lint && rtk proxy pnpm test && rtk proxy pnpm build`
Expected: все четыре — код 0.

Run: `rtk proxy pnpm test:e2e`
Expected: весь tier-1 зелёный. Первый прогон прогревает vite — при таймауте на холодном старте перезапустить, не «чинить» тест.

- [ ] **Step 6: Commit**

```bash
rtk proxy pnpm exec prettier --write src/features/positions/TpSlDialog.tsx e2e/pages/TerminalPanels.ts e2e/tier1/28-position-actions.spec.ts
git add src/features/positions/TpSlDialog.tsx e2e/pages/TerminalPanels.ts e2e/tier1/28-position-actions.spec.ts
git commit -m "$(cat <<'EOF'
feat(positions): диалог скобок гасит Save на цене не с той стороны и предупреждает о ликвидации

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Push и draft-PR**

```bash
git push -u origin feat-cld/bracket-price-check
```

Тело PR записать в `$TMPDIR/terminal-bracket-price-check-pr.md` (не в репозиторий):

```md
Скобка, чей триггер на текущей цене уже выполнен, уходила на шлюз из обоих мест терминала: опечатка в TP/SL (`300` вместо `3300`) срабатывала на первом тике `conditional-svc` и закрывала позицию по рынку, а по связке снимала вторую ногу. Правило приехало в SDK 0.57.0 (`validateBrackets`); здесь терминал начинает его звать.

**Что внутри**

- Тикет судит скобки **до** входа — иначе отказ пришёл бы после принятого входа и оставил позицию без стопа. Вердикт считается на **результирующую** позицию отдельно для каждой кнопки (`открытая + вход этой стороной`): тейк ниже цены запрещён длинной и нормален короткой, поэтому Buy и Sell гаснут порознь. Под полями TP/SL одна строка: подсказка `TP/SL fit a short only`, когда скобки годятся одной стороне, и причина по обеим, когда ни одной.
- `resultingPosition` — один расчёт на гейт и на подачу: разойдясь, они дали бы активную кнопку, чьи скобки действие тут же отклонит.
- Лимитный вход **без открытой позиции** судится ещё и против цены входа: стоп между лимитом и марком сгорел бы раньше, чем вход исполнится. При живой позиции опорная цена одна — марк.
- Диалог позиции: Save гаснет на отказе, причина — строкой `tpsl-validation` (отдельно от `tpsl-error`, где живёт отказ шлюза); «SL за ликвидацией» — предупреждение `tpsl-warning`, Save не гасит.
- SDK 0.57.0: `markPrice` в `ApplyBracketsInput` обязателен, поэтому бамп и правка обоих вызывающих — один коммит.

Спека: `docs/superpowers/specs/2026-09-18-bracket-price-check-design.md`. План: `docs/superpowers/plans/2026-09-20-bracket-price-check.md`. SDK-часть: liqcx/monorepo#790.

**Не покрыто e2e:** предупреждение о ликвидации. В tier-1 мок отдаёт `getRequiredMargins` нулями, поэтому `liquidationPrice` строки равна нулю и предупреждение не может сработать; правило покрыто юнитами SDK.

Проверка на приёме шлюза — liqcx/monorepo#789: она закроет прямой доступ к `POST /orders`, kwenta и ботов.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

```bash
gh pr create --draft --head feat-cld/bracket-price-check \
	--title "feat(trade): скобки судятся до подачи — кнопка стороны и Save гаснут на цене не с той стороны; SDK 0.57.0" \
	--body-file "$TMPDIR/terminal-bracket-price-check-pr.md"
```

Expected: URL draft-PR.

- [ ] **Step 8: Сверить пуш**

Run: `~/.claude/hooks/plan-state verify-push 3`
Expected: пуш подтверждён — `origin/feat-cld/bracket-price-check` совпадает с `HEAD`.

## Notes for next phase

_(заполняется исполнителем при закрытии фазы)_
