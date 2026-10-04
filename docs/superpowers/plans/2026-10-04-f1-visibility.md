# Ф1 · Видимость в терминале: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Терминал показывает исход ордера тостом (FAILED, системная отмена, истечение, сброс TP/SL) и строкой `TRIGGERED` в Open Orders, печатает ошибки через `humanizeError` вместо сырого `error.message` и не даёт подать Repay & Withdraw, когда USDC кошелька меньше долга; SDK поднят с 0.57.0 до 0.64.0.

**Architecture:** Слова и правила — в SDK (`describeOrderOutcome`, `humanizeError`, `IN_FLIGHT_ORDER_STATUSES` из `@liq/core`; `useAccountOrderUpdates` из `@liq/react`), терминал зовёт и печатает. Тостер — Radix Toast из уже подключённого `radix-ui` + маленький zustand-стор очереди; тосты исходов монтируются один раз внутри `SessionGate`, вне переключателя страниц. Гейт Repay — чистая функция `repayShortfall` в `features/account/` и строка под суммой в `CollateralAmountDialog`.

**Tech Stack:** React 19, Vite, TypeScript, Radix (`radix-ui`), zustand, vitest (юниты на чистые функции, `src/**/__tests__/*.test.ts`), Playwright tier-1 против мока шлюза, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-04-f1-visibility-design.md`. Задачи Plane: TRM-43, TRM-42, TRM-29 (модуль «Ф1 · Видимость»).

**Предшественник:** SDK-план `/home/alex/Work/perps/monorepo/.worktrees/f1-order-outcomes/docs/superpowers/plans/2026-10-04-f1-order-outcomes.md` → релиз `0.64.0`. Задачи 1 и 2 от него **не зависят** (0.63.0 уже в npm); задача 3 — зависит.

## Global Constraints

- Ветка `feat-cld/f1-visibility`, worktree `/home/alex/Work/perps/terminal/.worktrees/f1-visibility` (создан от `origin/main@adbda7a`). Все команды — из корня worktree. Основной чекаут `/home/alex/Work/perps/terminal` не трогать; `git stash` не использовать. У ветки нет upstream — пушить только `git push -u origin feat-cld/f1-visibility` (задача 3).
- **Node — из `.prototools` (24.14.0), не из mise (26).** На Node 26 глобальный `localStorage` ломает `src/stores/__tests__/useTerminalUiStore.test.ts` (6 падений, `Cannot read properties of undefined (reading 'setItem')`). Каждая команда с `pnpm`/`node` — с префиксом `export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH" &&`.
- Вывод `pnpm` с кириллицей роняет хук rtk — запускать через `rtk proxy <команда>`.
- **e2e — только через Docker-раннер** `bash /home/alex/tmp/claude-1000/-home-alex-Work-perps-terminal/2fa6167c-643b-4de4-9550-0f1340f86326/scratchpad/e2e-docker.sh [файлы спеков]`: на хосте (Ubuntu 26.04) нет системных библиотек Chromium, `pnpm test:e2e` не стартует. Раннер поднимает vite на хосте и гоняет Playwright в образе `mcr.microsoft.com/playwright:v1.60.0-noble`.
- Базовая линия (Node 24.14.0, `origin/main@adbda7a`): `rtk proxy pnpm test` — 166 тестов, 27 файлов, все зелёные; e2e через раннер — 186 passed (~1,1 мин).
- Гейты в конце каждой задачи, где менялся код: `rtk proxy pnpm typecheck`, `rtk proxy pnpm lint`, `rtk proxy pnpm test`, `rtk proxy pnpm build`, затем e2e-раннер целиком (без аргументов).
- `.npmrc` в корне worktree — копия с токеном реестра, в `.gitignore`; никогда не добавлять. Коммитить только явно перечисленные файлы (`git add <файлы>`), никогда `git add -A`. Каждый коммит завершается строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pre-commit хук обязателен — `--no-verify` не использовать.
- Prettier: двойные кавычки, точки с запятой, 2 пробела. Комментарии — TSDoc на русском, как у соседей; комментарий объясняет, какую поломку ловит. Названия тестов — как у соседей в том же файле или каталоге.
- Тексты для пользователя — английские, ровно из этого плана или из SDK. Слова исхода и ошибок терминал не пишет и не правит — печатает ответ `describeOrderOutcome` / `humanizeError` как есть.
- Контракт `data-testid` — инвариант: добавлять можно, переименовывать нельзя. Новые: `toast-viewport`, `order-outcome-toast`, `withdraw-wallet-short`.
- Исполнение по HARD RULE workspace: `plan-state init docs/superpowers/plans/2026-10-04-f1-visibility.md` до задачи 1; implementer — `subagent_type: implementer`, reviewer — `subagent_type: reviewer`.
- Спека и план коммитятся контроллером **до задачи 1**, отдельным коммитом: `git add docs/superpowers/specs/2026-10-04-f1-visibility-design.md docs/superpowers/plans/2026-10-04-f1-visibility.md` → `docs: спека и план Ф1 — видимость исходов и ошибок`.
- Один draft-PR в `main` (`gh pr create --draft`) в задаче 3, не раньше. В названии — номера TRM.

## Review Focus

- После перехода на 0.63 `Position.size` знаковый во всех источниках SDK (deep-07): место терминала, которое печатает размер или считает по нему, не должно показывать `-0.31` у шорта и не должно дважды применять знак (задача 1, аудит `.size`).
- Дубль `order_update` одного ордера с одним статусом (шлюз зеркалит два броадкаста) — один тост, не два (задача 3, e2e «дубль»).
- Голый CANCELLED после Cancel в Open Orders и после Save в диалоге TP/SL — ни одного тоста (задача 3, e2e).
- Пока баланс кошелька не пришёл (`useDepositableBalance` ещё грузится), Repay & Withdraw не гаснет по ошибке; когда пришёл и меньше долга — гаснет со строкой и суммами (задача 2, юниты `repayShortfall` и e2e).
- Тост по ордеру, которого нет в кешах (сработавший TP/SL между опросами), выходит без подписи, а не падает (задача 3, e2e).

## Карта файлов

| файл | ответственность |
| --- | --- |
| `package.json`, `pnpm-lock.yaml` | `@liq/*` `^0.63.0` (задача 1), `^0.64.0` (задача 3) |
| `src/features/trade/resultingPosition.ts` + `__tests__/resultingPosition.test.ts` | без `toSignedSize`: размер позиции уже знаковый |
| `src/features/trade/TradeForm.tsx` | вердикт стороны через `bracketsPlanFor` (задача 1); `humanizeError` (задача 2) |
| `src/features/positions/TpSlDialog.tsx` | вердикт через `bracketsPlanFor` (задача 1); `humanizeError` (задача 2) |
| `src/features/auth/SessionCta.tsx` | `ErrorLine` по умолчанию печатает `humanizeError` |
| `src/features/positions/PositionsTable.tsx`, `src/features/account/FaucetDialog.tsx`, `src/features/account/CollateralAmountDialog.tsx` | `humanizeError` вместо `error.message` |
| `src/features/account/repayShortfall.ts` (новый) + `__tests__/repayShortfall.test.ts` | сколько USDC кошелька не хватает до долга |
| `src/features/account/WithdrawDialog.tsx` | гейт Repay по `repayShortfall`, строка `withdraw-wallet-short` |
| `src/components/ui/toast.tsx` (новый) | обёртка Radix Toast в стилях терминала |
| `src/stores/useToastStore.ts` (новый) + `__tests__/useToastStore.test.ts` | очередь тостов, дедупликация по ключу |
| `src/features/orders/useOrderOutcomeToasts.ts` (новый) | `useAccountOrderUpdates` → `describeOrderOutcome` → стор |
| `src/features/orders/OrderOutcomeToasts.tsx` (новый) | монтирует хук и рисует тосты |
| `src/App.tsx` | `OrderOutcomeToasts` внутри `SessionGate`, вне переключателя страниц |
| `src/features/orders/OpenOrdersTable.tsx` | подсказка Cancel для `TRIGGERED` |
| `e2e/support/world.ts` | `sseOrderUpdateFrame(..., { reason, origin, channel })` |
| `e2e/pages/TerminalPanels.ts` | локаторы `toastViewport`, `outcomeToasts`, `walletShort` |
| `e2e/tier1/*.spec.ts` | новые спеки тостов, TRIGGERED, гейта Repay |

---

### Task 1: SDK 0.63.0 — план скобок вместо вердикта, знаковый размер

Терминал на `^0.57.0`, в npm уже `0.63.0` (`npm view @liqpro/liq-core version`). Подъём ломает сборку в четырёх местах (проверено `tsc -b` на 0.63.0):

```
src/features/positions/TpSlDialog.tsx(5,3): error TS2305: Module '"@liq/sdk"' has no exported member 'validateBrackets'.
src/features/trade/TradeForm.tsx(3,8): error TS2305: Module '"@liq/sdk"' has no exported member 'BracketsVerdict'.
src/features/trade/TradeForm.tsx(12,3): error TS2305: Module '"@liq/sdk"' has no exported member 'validateBrackets'.
src/features/trade/resultingPosition.ts(1,21): error TS2305: Module '"@liq/sdk"' has no exported member 'toSignedSize'.
```

Что сменилось в SDK (тела PR и коммиты `be02973c`, `ca78ad91` в monorepo):
- 0.58.0: `validateBrackets` и `BracketsVerdict` удалены; `bracketsPlanFor(input)` судит ноги сам и отвечает `BracketsPlan { changes, rejected: BracketRejection[], warn }`. Вход тот же (`position, brackets, takeProfit, stopLoss, markPrice, entryPrice?, liquidationPrice?`). Прежний `verdict.ok` = «ни одного отказа, включая `not-ready`» (`liq@0.57.0:packages/liq-core/src/positions/brackets-check.ts:160`) — теперь это `plan.rejected.length === 0`. `describeBracketRejection(r)` и `describeBracketWarning(plan.warn)` — те же тексты. Спека: `/home/alex/Work/perps/monorepo/docs/superpowers/specs/2026-09-23-brackets-plan-verdict-design.md`.
- 0.62–0.63 (deep-07): `toSignedSize` удалён; `Position.size` у каждого производителя SDK знаковый (`> 0` длинная, `< 0` короткая), `side` выводится из знака. Форма «модуль + SELL» больше не существует — её тест в терминале удаляется, а не переносится.
- Удалены ещё 59 имён `@liq/react` и 59 — `@liq/onchain`/`@liq/sdk` (deep-14); терминал ни одно из них не импортирует — `tsc` других ошибок не дал.

**Files:**
- Modify: `package.json:21-25`, `pnpm-lock.yaml`
- Modify: `src/features/trade/resultingPosition.ts`
- Modify: `src/features/trade/__tests__/resultingPosition.test.ts`
- Modify: `src/features/trade/TradeForm.tsx:1-13, 163-208, 253` (импорты, `verdictFor`, `longOk`/`shortOk`, `legsOf`, TSDoc `attachBrackets`)
- Modify: `src/features/positions/TpSlDialog.tsx:1-6, 62-78`

**Interfaces:**
- Consumes: `bracketsPlanFor`, `BracketsPlan`, `describeBracketRejection`, `describeBracketWarning` из `@liq/sdk` 0.63.0.
- Produces: `resultingPosition(marketId: bigint, open: { size: bigint } | undefined, entryDelta: Qty): { marketId: bigint; side: Side; size: Qty }` — `open.size` знаковый. Задачи 2–3 эти файлы не трогают, кроме строк ошибок.

- [ ] **Step 1: Поднять SDK**

```bash
export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH"
sed -i 's/@\^0\.57\.0"/@^0.63.0"/' package.json
grep -n 'liqpro' package.json
rtk proxy pnpm install
```

Expected: пять строк `npm:@liqpro/liq-*@^0.63.0`; `node_modules/@liq/core/package.json` — `"version": "0.63.0"`.

- [ ] **Step 2: Убедиться, что сборка падает ровно в четырёх местах**

Run: `rtk proxy pnpm typecheck`
Expected: FAIL — ровно четыре ошибки из списка выше. Другая ошибка — остановиться и вернуть `NEEDS_CONTEXT` с выводом.

- [ ] **Step 3: Тест `resultingPosition` под знаковый размер**

В `src/features/trade/__tests__/resultingPosition.test.ts`:
1. Во всех фикстурах `open` убрать поле `side` (`{ size: 2n * WAD, side: Side.BUY }` → `{ size: 2n * WAD }` и т. д.).
2. Последний тест «размер открытой позиции по модулю приводится знаком стороны» заменить:

```ts
  it("короткая открытая позиция приходит со знаком и гасится покупкой", () => {
    // С SDK 0.63 размер позиции знаковый у всех источников (deep-07): шорт 1 —
    // это size = -1, а не модуль с SELL. Покупка 1 его закрывает.
    const open = { size: -WAD };
    expect(resultingPosition(MARKET, open, Qty(WAD)).size).toBe(Qty(0n));
  });
```

Run: `rtk proxy pnpm test src/features/trade/__tests__/resultingPosition.test.ts`
Expected: FAIL на типах или на последнем тесте (функция ещё зовёт `toSignedSize`).

- [ ] **Step 4: `resultingPosition` без `toSignedSize`**

Заменить `src/features/trade/resultingPosition.ts` целиком:

```ts
import { Qty, Side } from "@liq/sdk";

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
 * Размер открытой позиции знаковый у всех источников SDK с 0.63 (deep-07),
 * поэтому складывается как есть. Нулевой размер (полное закрытие) — не особый
 * случай: закрывать нечем, и `bracketsPlanFor` ног не подаёт и не судит.
 */
export function resultingPosition(
  marketId: bigint,
  open: { size: bigint } | undefined,
  entryDelta: Qty,
): { marketId: bigint; side: Side; size: Qty } {
  const size = Qty((open?.size ?? 0n) + entryDelta);
  return { marketId, side: size < 0n ? Side.SELL : Side.BUY, size };
}
```

Run: `rtk proxy pnpm test src/features/trade/__tests__/resultingPosition.test.ts`
Expected: PASS (6 тестов).

- [ ] **Step 5: Тикет — план вместо вердикта**

В `src/features/trade/TradeForm.tsx`:
1. В импорте из `@liq/sdk` заменить `type BracketsVerdict,` на `type BracketsPlan,`, а `validateBrackets,` на `bracketsPlanFor,` (сохранить алфавитный порядок, как у соседей: `acceptablePrice, type BracketsPlan, bracketsPlanFor, Bps, …`).
2. `verdictFor`: тип возврата `BracketsPlan | null`, вызов `validateBrackets({…})` → `bracketsPlanFor({…})` с тем же объектом.
3. Строки `longOk` / `shortOk`:

```ts
  // Ни одного отказа, включая `not-ready` (марка нет): так судил и прежний
  // `verdict.ok` (SDK 0.57), и кнопка без марка гаснет, а не подаёт вслепую.
  const longOk = (longVerdict?.rejected.length ?? 0) === 0;
  const shortOk = (shortVerdict?.rejected.length ?? 0) === 0;
```

4. `legsOf`:

```ts
  /** Отказы одной стороны одной строкой; пусто — сторона годна или судить нечем. */
  function legsOf(label: string, verdict: BracketsPlan | null): string {
    const legs = (verdict?.rejected ?? [])
      .map((rejection) => describeBracketRejection(rejection))
      .filter((t) => t !== undefined)
      .join(" · ");
    return legs === "" ? "" : `${label} — ${legs}`;
  }
```

5. В TSDoc `attachBrackets` строку «размер с размером входа складывает `resultingPosition` — там же знак приводит `toSignedSize`, часть источников несёт размер по модулю.» заменить на «размер с размером входа складывает `resultingPosition`.».

- [ ] **Step 6: Диалог TP/SL — план вместо вердикта**

В `src/features/positions/TpSlDialog.tsx`:
1. Импорт: `validateBrackets,` → `bracketsPlanFor,`.
2. Блок вердикта:

```ts
  // Марк строки живой: таблица обновляет его вместе с ценами, и план
  // пересчитывается — скобка, законная минуту назад, гаснет вместе с ценой.
  const plan = bracketsPlanFor({
    position: row.position,
    brackets: row.brackets,
    takeProfit: tpPrice,
    stopLoss: slPrice,
    markPrice: Price(row.markPrice ?? 0n),
    liquidationPrice: row.position.liquidationPrice,
  });
  const rejection = plan.rejected
    .map((r) => describeBracketRejection(r))
    .filter((t) => t !== undefined)
    .join(" · ");
  const warning = describeBracketWarning(plan.warn);
```

3. Если ниже по файлу есть другие обращения к `verdict` (например, `disabled={!verdict.ok …}`), заменить на `plan.rejected.length > 0` с тем же смыслом: `rtk proxy rg -n "verdict" src/features/positions/TpSlDialog.tsx` после правки — пусто.

- [ ] **Step 7: Аудит знакового размера**

Run: `rtk proxy rg -n "\.size\b|\.side\b" src --glob '!**/__tests__/**'`
Expected: размер позиции печатается через `abs(...)` (`PositionsTable.tsx:75`, `ClosePositionsDialog.tsx:78`); `side` читается только для подписи стороны. Место, где размер позиции печатается без `abs` или где знак применяется по `side` повторно (`side === SELL ? -size : size`), — исправить на чтение знака и внести файл в коммит. Размер сделки (`TradeHistoryTable`, `trade.size`) — не позиция, не трогать.

- [ ] **Step 8: Гейты**

```bash
export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH"
rtk proxy pnpm typecheck && rtk proxy pnpm lint && rtk proxy pnpm test && rtk proxy pnpm build
bash /home/alex/tmp/claude-1000/-home-alex-Work-perps-terminal/2fa6167c-643b-4de4-9550-0f1340f86326/scratchpad/e2e-docker.sh
```

Expected: всё зелёное; unit — 166 тестов (число не меняется: один тест заменён); e2e — как в базовой линии, включая гейты скобок `04-trade-market.spec.ts` и `28-position-actions.spec.ts`.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/features/trade/resultingPosition.ts src/features/trade/__tests__/resultingPosition.test.ts src/features/trade/TradeForm.tsx src/features/positions/TpSlDialog.tsx
git commit -m "$(cat <<'MSG'
chore(deps): SDK 0.63.0 — план скобок вместо вердикта, размер позиции знаковый

validateBrackets и BracketsVerdict ушли в 0.58.0: тикет и диалог TP/SL
судят ноги через bracketsPlanFor, «годно» — ни одного отказа в
plan.rejected, как прежний verdict.ok. toSignedSize ушёл в 0.63.0:
размер позиции знаковый у всех источников SDK, resultingPosition
складывает его как есть.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

### Task 2: Ошибки словами и гейт Repay & Withdraw

Две вещи одного класса — пользователь видит сырой текст там, где SDK уже умеет сказать по-человечески (TRM-42), и диалог вывода отправляет транзакцию, которая заведомо откатится (TRM-29).

**`humanizeError` везде.** Сейчас его зовёт только `TurnkeyLoginButton.tsx:60`. Сырой `error.message` печатают семь мест: `TradeForm.tsx:481`, `TpSlDialog.tsx:162`, `CollateralAmountDialog.tsx:170` (депозит и вывод), `PositionsTable.tsx:275` (Close), `FaucetDialog.tsx:72` и `:129`, `SessionCta.tsx:86` (`ErrorLine` — создание счёта, вход в шлюз, смена сети; ни один вызывающий не передаёт `formatMessage`). `humanizeError(error: unknown): string` есть в `@liq/core` 0.63.0 — margin-отказ шлюза печатает суммами вместо wei, отказ в кошельке и нехватку газа — своими строками; тексты TRM-31 и «unknown reason» приедут с 0.64.0 (задача 3) без правок терминала.

**Гейт Repay.** `useWithdrawMutation` при долге гасит его в голове плана из **USDC кошелька** (`RepayBuilder` берёт `addresses.usdc` при любом выбранном токене вывода; терминал не передаёт `repayFromSUSDC`). Диалог баланс кошелька не читает — при пустом кошельке транзакция откатывается с «simulation failed: Execution reverted for an unknown reason». `useDepositableBalance('USDC').data.token` — баланс USDC кошелька в WAD, как и долг из `useAccountDebtQuery`. Правило (спека, п. 6): долг есть, баланс пришёл и меньше долга — кнопка гаснет, строка объясняет; баланс ещё не пришёл — не гасим.

**Files:**
- Modify: `src/features/trade/TradeForm.tsx:479-483`
- Modify: `src/features/positions/TpSlDialog.tsx:160-164`
- Modify: `src/features/account/CollateralAmountDialog.tsx` (импорт; строка ошибки `:165-172`; новый проп `blockedReason`)
- Modify: `src/features/positions/PositionsTable.tsx:274-276`
- Modify: `src/features/account/FaucetDialog.tsx:70-74, 127-131`
- Modify: `src/features/auth/SessionCta.tsx:72-90`
- Create: `src/features/account/repayShortfall.ts`
- Create: `src/features/account/__tests__/repayShortfall.test.ts`
- Modify: `src/features/account/WithdrawDialog.tsx`
- Modify: `e2e/support/world.ts` (поле `walletUsdc`), `e2e/support/chain.ts:119-130` (`balanceOf` USDC)
- Modify: `e2e/pages/TerminalPanels.ts` (локатор `walletShort` у диалога вывода)
- Modify: `e2e/tier1/03-deposit-withdraw.spec.ts` (два теста в `describe` с долгом)

**Interfaces:**
- Consumes: `humanizeError` из `@liq/core`; `useDepositableBalance`, `useAccountDebtQuery` из `@liq/react`; `formatUsd` из `@liq/core`.
- Produces: `repayShortfall(debt: bigint | undefined, walletToken: bigint | undefined): bigint | null`; проп `CollateralAmountDialog.blockedReason?: ReactNode` (строка под суммой, гасит кнопку); `MockWorld.walletUsdc?: bigint` (6-dec, сырой). Задача 3 эти имена не использует.

- [ ] **Step 1: Write the failing test — `repayShortfall`**

Create `src/features/account/__tests__/repayShortfall.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { repayShortfall } from "../repayShortfall";

const WAD = 10n ** 18n;

describe("repayShortfall", () => {
  it("без долга не мешает выводу", () => {
    expect(repayShortfall(0n, 0n)).toBeNull();
    expect(repayShortfall(undefined, 0n)).toBeNull();
  });

  it("пока баланс кошелька не пришёл — не гасит", () => {
    // Молчащий RPC отдаёт нули; ложная блокировка вывода хуже ревёрта,
    // который теперь печатается словами.
    expect(repayShortfall(168n * WAD, undefined)).toBeNull();
  });

  it("кошелька не хватает до долга — отвечает недостачей", () => {
    // TRM-29: долг $168, в кошельке 0 — «Repay & Withdraw» откатывался.
    expect(repayShortfall(168n * WAD, 0n)).toBe(168n * WAD);
    expect(repayShortfall(168n * WAD, 100n * WAD)).toBe(68n * WAD);
  });

  it("ровно на долг или больше — гасить можно", () => {
    expect(repayShortfall(168n * WAD, 168n * WAD)).toBeNull();
    expect(repayShortfall(168n * WAD, 400n * WAD)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH" && rtk proxy pnpm test src/features/account/__tests__/repayShortfall.test.ts`
Expected: FAIL — `Failed to resolve import "../repayShortfall"`.

- [ ] **Step 3: Write minimal implementation — `repayShortfall`**

Create `src/features/account/repayShortfall.ts`:

```ts
/**
 * Сколько USDC кошелька не хватает, чтобы погасить долг в голове вывода.
 *
 * @remarks Вывод при долге гасит его из USDC кошелька (`RepayBuilder` SDK),
 * и при пустом кошельке транзакция откатывалась «for an unknown reason»
 * (TRM-29). Оба числа — WAD: долг протокола и `useDepositableBalance().token`.
 *
 * Баланс, которого ещё нет, — не повод гасить кнопку: молчащий RPC отдаёт
 * нули, и ложная блокировка вывода хуже ревёрта с понятным текстом.
 *
 * @returns недостачу (`> 0n`) или `null`, когда гасить вывод не нужно.
 */
export function repayShortfall(
  debt: bigint | undefined,
  walletToken: bigint | undefined,
): bigint | null {
  if (debt === undefined || debt <= 0n || walletToken === undefined) return null;
  return walletToken < debt ? debt - walletToken : null;
}
```

Run: `export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH" && rtk proxy pnpm test src/features/account/__tests__/repayShortfall.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 4: Проп `blockedReason` у тела диалога**

В `src/features/account/CollateralAmountDialog.tsx`:
1. В типе пропсов после `notice?: ReactNode;`:

```ts
  /**
   * Почему отправить нельзя, хотя сумма годна (у вывода — не хватает USDC
   * кошелька на долг). Есть — кнопка гаснет, строка стоит под суммой.
   */
  blockedReason?: ReactNode;
```

2. Деструктурировать `blockedReason` рядом с `notice`.
3. `const blocked = disabled || pending || amountWad <= 0n || exceedsLimit || blockedReason != null;` (`!= null` ловит и `undefined`, и `null`; вызывающий передаёт `null`, когда причины нет).
4. Сразу после блока `exceedsLimit` (строка `${testIdPrefix}-validation`) и перед блоком `error`:

```tsx
        {blockedReason != null && (
          <p className="mt-2 text-[11px] text-short">{blockedReason}</p>
        )}
```

5. В блоке `error` заменить `{error.message}` на `{humanizeError(error)}`; добавить `humanizeError` в импорт из `@liq/core`.

- [ ] **Step 5: Гейт в диалоге вывода**

В `src/features/account/WithdrawDialog.tsx`:
1. Импорты: `useDepositableBalance` из `@liq/react`; `repayShortfall` из `./repayShortfall`.
2. После `const hasDebt = …`:

```ts
  // Долг гасится из USDC кошелька при любом выбранном токене вывода
  // (`RepayBuilder` SDK). Без проверки пустой кошелёк узнавал об этом
  // ревёртом симуляции (TRM-29).
  const { data: wallet } = useDepositableBalance("USDC");
  const shortfall = repayShortfall(debt, hasDebt ? wallet?.token : undefined);
```

3. В JSX `CollateralAmountDialog` после `notice={…}` добавить (тернарный оператор, не `&&`: `false` от `&&` проп принял бы за причину и погасил бы кнопку):

```tsx
      blockedReason={
        shortfall === null ? null : (
          <span data-testid="withdraw-wallet-short">
            Not enough USDC in your wallet to repay the {formatUsd(debt ?? 0n)}{" "}
            debt (wallet: {formatUsd(wallet?.token ?? 0n)}). Top up the wallet
            first.
          </span>
        )
      }
```

- [ ] **Step 6: `humanizeError` в остальных местах**

1. `src/features/trade/TradeForm.tsx`: `{error.message}` (строка `trade-error`) → `{humanizeError(error)}`; импорт `humanizeError` из `@liq/core` (в файле уже есть импорты из `@liq/core`? если нет — новая строка `import { humanizeError } from "@liq/core";`).
2. `src/features/positions/TpSlDialog.tsx`: `{applyBrackets.error.message}` → `{humanizeError(applyBrackets.error)}`; в импорт `import { wadToFixed } from "@liq/core";` добавить `humanizeError`.
3. `src/features/positions/PositionsTable.tsx`: `setError(e instanceof Error ? e.message : String(e));` → `setError(humanizeError(e));`; импорт из `@liq/core`.
4. `src/features/account/FaucetDialog.tsx`: `{state.error.message}` → `{humanizeError(state.error)}`, `{claim.error.message}` → `{humanizeError(claim.error)}`; импорт.
5. `src/features/auth/SessionCta.tsx`, `ErrorLine`:

```tsx
  /** Переопределяет {@link humanizeError} — например, чтобы назвать конкретную причину иначе. */
  formatMessage?: (error: Error) => string;
```

и тело `{formatMessage ? formatMessage(error) : humanizeError(error)}`; импорт `humanizeError` из `@liq/core`. TSDoc функции: `/** Surfaces a mutation error inline, worded by \`humanizeError\`, so a failed CTA isn't a silent dead-end. */`.

Run: `rtk proxy rg -n "error\.message|e\.message|claim\.error\.message|String\(e\)" src --glob '!**/__tests__/**'`
Expected: пусто.

- [ ] **Step 7: e2e — мок баланса и два теста гейта**

1. `e2e/support/world.ts`, в `MockWorld` после `accounts: AccountFixture[];`:

```ts
  /**
   * USDC в кошельке — сырой, 6 знаков. Нет — миллион: депозиту хватает на
   * всё. Задаётся, чтобы проверить гейт погашения долга (TRM-29).
   */
  walletUsdc?: bigint;
```

2. `e2e/support/chain.ts`, `case "balanceOf"`: заменить `logical === "USDC" ? 1_000_000n * 10n ** 6n : …` на `logical === "USDC" ? (world.walletUsdc ?? 1_000_000n * 10n ** 6n) : …`.
3. `e2e/pages/TerminalPanels.ts`, класс диалога вывода (рядом с `debtNotice`): поле `readonly walletShort: Locator;` и в конструкторе `this.walletShort = page.getByTestId("withdraw-wallet-short");`.
4. `e2e/tier1/03-deposit-withdraw.spec.ts`, после теста «an account with debt offers an atomic Repay & Withdraw» в том же `describe`:

```ts
  test("Repay & Withdraw is blocked when the wallet USDC cannot cover the debt", async ({
    page,
    world,
  }) => {
    // TRM-29: пустой кошелёк при долге — транзакция откатывалась без причины.
    const { market, withdraw } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].debt = 168n * WAD;
      w.walletUsdc = 0n;
      return w;
    });

    await market.openWithdraw();
    await withdraw.amountInput.fill("1");
    await expect(withdraw.walletShort).toBeVisible();
    await expect(withdraw.walletShort).toContainText("$168.00");
    await expect(withdraw.submitButton).toBeDisabled();
  });

  test("Repay & Withdraw stays available when the wallet covers the debt", async ({
    page,
    world,
  }) => {
    const { market, withdraw } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].debt = 168n * WAD;
      w.walletUsdc = 400n * 10n ** 6n;
      return w;
    });

    await market.openWithdraw();
    await withdraw.amountInput.fill("1");
    await expect(withdraw.submitButton).toHaveText("Repay & Withdraw");
    await expect(withdraw.submitButton).toBeEnabled();
    await expect(withdraw.walletShort).toHaveCount(0);
  });
```

Если `formatUsd` печатает долг иначе, чем `$168.00`, — взять строку из соседнего `debtNotice` (тот же `formatUsd`) и подставить её.

Run: `bash /home/alex/tmp/claude-1000/-home-alex-Work-perps-terminal/2fa6167c-643b-4de4-9550-0f1340f86326/scratchpad/e2e-docker.sh e2e/tier1/03-deposit-withdraw.spec.ts e2e/tier1/12-errors.spec.ts`
Expected: PASS. До шага 5 первый новый тест падает (кнопка активна) — проверить это, временно закомментировав `blockedReason` в `WithdrawDialog`, и вернуть.

- [ ] **Step 8: Гейты**

```bash
export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH"
rtk proxy pnpm typecheck && rtk proxy pnpm lint && rtk proxy pnpm test && rtk proxy pnpm build
bash /home/alex/tmp/claude-1000/-home-alex-Work-perps-terminal/2fa6167c-643b-4de4-9550-0f1340f86326/scratchpad/e2e-docker.sh
```

Expected: всё зелёное; unit — 170 тестов (166 + 4); e2e — базовая линия + 2. Тесты, которые проверяли строку ошибки текстом (`04-trade-market.spec.ts:252`, `28-position-actions.spec.ts:214` — «Take profit»), проходят без правок: `humanizeError` такие строки не меняет.

- [ ] **Step 9: Commit**

```bash
git add src/features/trade/TradeForm.tsx src/features/positions/TpSlDialog.tsx src/features/account/CollateralAmountDialog.tsx src/features/positions/PositionsTable.tsx src/features/account/FaucetDialog.tsx src/features/auth/SessionCta.tsx src/features/account/repayShortfall.ts src/features/account/__tests__/repayShortfall.test.ts src/features/account/WithdrawDialog.tsx e2e/support/world.ts e2e/support/chain.ts e2e/pages/TerminalPanels.ts e2e/tier1/03-deposit-withdraw.spec.ts
git commit -m "$(cat <<'MSG'
fix(account,trade): ошибки словами SDK, Repay & Withdraw не уходит без USDC на долг (TRM-42, TRM-29)

Семь мест печатали сырой error.message — wei в margin-отказе, внутренний
id счёта, «unknown reason». Теперь — humanizeError из @liq/core, как уже
делал вход через Turnkey; ErrorLine humanize'ит по умолчанию.

Вывод при долге гасит его из USDC кошелька. Когда баланс пришёл и меньше
долга, кнопка гаснет, а строка называет долг, баланс и что сделать.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

### Task 3: SDK 0.64.0 — тосты исходов, строка TRIGGERED, draft-PR

**Предусловие:** `npm view @liqpro/liq-core version` показывает `0.64.0` (SDK-PR смержен в `staging`, владелец запушил тег `liq@0.64.0`). Пока нет — задачу не начинать: вернуть `BLOCKED` с выводом команды.

Что приезжает с 0.64.0 (SDK-план, задачи 1–3):
- `IN_FLIGHT_ORDER_STATUSES` содержит `TRIGGERED` → `useOpenOrdersQuery` его отдаёт, `isInFlight("TRIGGERED") === true`. Мок e2e берёт наборы из SDK (`e2e/support/mockGateway.ts:204-208`) — строка с `status: "TRIGGERED"` в `world.openOrders` появится в таблице сама.
- `describeOrderOutcome(update, order?) → { tone: 'error' | 'warning' | 'info'; title; detail? } | null` из `@liq/core`. Правило: FAILED — всегда; CANCELLED — только с `reason` (голый — отмена пользователем; `origin: 'pool_execution'` — исполнение); EXPIRED, TRIGGER_DROPPED — предупреждения; остальное — `null`.
- `useAccountOrderUpdates(onUpdate?)` из `@liq/react`: одна подписка на приватный `orders:{accountId}`, колбэк с полным `OrderUpdateData` (`orderId, status, reason?, origin?, …`), устаревание списков как у `useSseOrderUpdates`. События не дедуплицирует — это делает терминал.
- `humanizeError` узнаёт «registered to a different wallet» (TRM-31) и «execution reverted for an unknown reason» (TRM-29) — терминал после задачи 2 печатает их без правок.

Тостер — Radix Toast из `radix-ui` (`import { Toast as ToastPrimitive } from "radix-ui";`, как `Dialog` в `src/components/ui/dialog.tsx`); новой зависимости нет. Очередь — маленький zustand-стор. Тосты исходов монтируются один раз внутри `SessionGate` (нужны сессия и счёт), но **вне** переключателя страниц: на странице Account терминал размонтируется, а исход ордера должен быть виден и там. Ошибка (`tone: 'error'`) висит до закрытия — упавший стоп-лосс означает позицию без защиты; остальные — 8 секунд.

**Files:**
- Modify: `package.json:21-25`, `pnpm-lock.yaml`
- Create: `src/stores/useToastStore.ts`
- Create: `src/stores/__tests__/useToastStore.test.ts`
- Create: `src/components/ui/toast.tsx`
- Create: `src/features/orders/useOrderOutcomeToasts.ts`
- Create: `src/features/orders/OrderOutcomeToasts.tsx`
- Modify: `src/App.tsx` (провайдер и вьюпорт вокруг оболочки; `OrderOutcomeToasts` первым ребёнком `SessionGate`)
- Modify: `src/features/orders/OpenOrdersTable.tsx:86-89` (подсказка Cancel), `src/features/orders/useOpenOrderRows.ts:20-27` (TSDoc `cancellable`)
- Modify: `e2e/support/world.ts:749-756` (`sseOrderUpdateFrame` с опциями)
- Modify: `e2e/pages/TerminalPanels.ts` (класс `ToastsPanel`)
- Create: `e2e/tier1/31-order-outcome-toasts.spec.ts`

**Interfaces:**
- Consumes: `describeOrderOutcome`, `GatewayOrder`, `OrderUpdateData` из `@liq/core` 0.64.0; `useAccountOrderUpdates`, `useAccountId`, `useOpenOrdersQuery`, `useConditionalOrders` из `@liq/react`; `marketSymbol`, `useSelectedMarket` из `src/features/market/useSelectedMarket`.
- Produces: `useToastStore` (`toasts: AppToast[]`, `push(t: AppToast)`, `dismiss(id: string)`); `AppToast = { id: string; tone: "error" | "warning" | "info"; title: string; detail?: string; meta?: string }`; `ToastProvider`, `ToastViewport`, `ToastCard` из `@/components/ui/toast`; `sseOrderUpdateFrame(orderId, status, opts?: { reason?: string; origin?: "pool_execution"; channel?: string })`.

- [ ] **Step 1: Поднять SDK до 0.64.0**

```bash
export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH"
npm view @liqpro/liq-core version   # 0.64.0, иначе BLOCKED
sed -i 's/@\^0\.63\.0"/@^0.64.0"/' package.json
rtk proxy pnpm install
rtk proxy pnpm typecheck && rtk proxy pnpm test
```

Expected: `typecheck` и unit зелёные без правок кода (0.64.0 только добавляет имена).

- [ ] **Step 2: Write the failing test — стор тостов**

Create `src/stores/__tests__/useToastStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { useToastStore } from "../useToastStore";

const toast = (id: string) => ({ id, tone: "error" as const, title: `t-${id}` });

describe("useToastStore", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("показывает тост и убирает закрытый", () => {
    useToastStore.getState().push(toast("a"));
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual(["a"]);
    useToastStore.getState().dismiss("a");
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("тот же id не задваивается, пока тост на экране", () => {
    // Шлюз зеркалит в канал счёта два броадкаста одного исхода.
    useToastStore.getState().push(toast("a"));
    useToastStore.getState().push(toast("a"));
    expect(useToastStore.getState().toasts.length).toBe(1);
  });

  it("держит не больше пяти — старые уходят первыми", () => {
    for (const id of ["1", "2", "3", "4", "5", "6"]) {
      useToastStore.getState().push(toast(id));
    }
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
  });
});
```

Run: `export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH" && rtk proxy pnpm test src/stores/__tests__/useToastStore.test.ts`
Expected: FAIL — `Failed to resolve import "../useToastStore"`.

- [ ] **Step 3: Стор тостов**

Create `src/stores/useToastStore.ts`:

```ts
import { create } from "zustand";

/** Тост экрана: слова — от SDK (`describeOrderOutcome`), подпись ордера — от терминала. */
export interface AppToast {
  /** Ключ дедупликации; у исхода ордера — `orderId:status`. */
  id: string;
  tone: "error" | "warning" | "info";
  title: string;
  detail?: string;
  /** Подпись ордера: сторона и рынок. Нет — ордера не было в кешах. */
  meta?: string;
}

interface ToastState {
  toasts: AppToast[];
  push: (toast: AppToast) => void;
  dismiss: (id: string) => void;
}

/** Больше пяти тостов разом — уже не подсказка, а стена; старые уходят первыми. */
const MAX_TOASTS = 5;

/**
 * Очередь тостов.
 *
 * @remarks Тот же `id`, пока тост на экране, не задваивается: шлюз зеркалит в
 * канал счёта и статус-, и сеттлмент-броадкаст одного исхода. Повтор после
 * закрытия отсекает вызывающий (`useOrderOutcomeToasts` помнит показанные).
 */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (toast) =>
    set((s) =>
      s.toasts.some((t) => t.id === toast.id)
        ? s
        : { toasts: [...s.toasts, toast].slice(-MAX_TOASTS) },
    ),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
```

Run: `export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH" && rtk proxy pnpm test src/stores/__tests__/useToastStore.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 4: Компонент тоста**

Create `src/components/ui/toast.tsx`:

```tsx
import * as React from "react";
import { XIcon } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import type { AppToast } from "@/stores/useToastStore";

/** Провайдер тостов: один на приложение, вокруг оболочки экрана. */
export const ToastProvider = ToastPrimitive.Provider;

/** Угол экрана, куда встают тосты. */
export function ToastViewport() {
  return (
    <ToastPrimitive.Viewport
      data-testid="toast-viewport"
      className="fixed right-3 bottom-3 z-50 flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2 outline-none"
    />
  );
}

const TONE: Record<AppToast["tone"], { border: string; title: string }> = {
  error: { border: "border-short/50", title: "text-short" },
  warning: { border: "border-accent/50", title: "text-accent" },
  info: { border: "border-border", title: "text-text" },
};

/**
 * Один тост.
 *
 * @remarks Ошибка висит до закрытия: упавший стоп-лосс — это позиция без
 * защиты, и тост, ушедший сам за 8 секунд, мог её спрятать.
 */
export function ToastCard({
  toast,
  onOpenChange,
  ...props
}: {
  toast: AppToast;
  onOpenChange: (open: boolean) => void;
} & Omit<React.ComponentProps<typeof ToastPrimitive.Root>, "onOpenChange">) {
  const tone = TONE[toast.tone];
  return (
    <ToastPrimitive.Root
      duration={toast.tone === "error" ? Infinity : 8000}
      onOpenChange={onOpenChange}
      className={cn(
        "rounded border bg-surface-2 p-2 text-[11px] shadow-lg",
        tone.border,
      )}
      {...props}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ToastPrimitive.Title className={cn("font-semibold", tone.title)}>
            {toast.title}
          </ToastPrimitive.Title>
          {toast.detail !== undefined && (
            <ToastPrimitive.Description className="text-text">
              {toast.detail}
            </ToastPrimitive.Description>
          )}
          {toast.meta !== undefined && (
            <p className="mt-0.5 text-muted">{toast.meta}</p>
          )}
        </div>
        <ToastPrimitive.Close aria-label="Dismiss" className="text-muted hover:text-text">
          <XIcon className="size-3" />
        </ToastPrimitive.Close>
      </div>
    </ToastPrimitive.Root>
  );
}
```


- [ ] **Step 5: Хук и монтирование тостов исходов**

Create `src/features/orders/useOrderOutcomeToasts.ts`:

```ts
import { describeOrderOutcome, type GatewayOrder } from "@liq/core";
import {
  useAccountId,
  useAccountOrderUpdates,
  useConditionalOrders,
  useOpenOrdersQuery,
} from "@liq/react";
import { useEffect, useRef } from "react";

import { useToastStore } from "../../stores/useToastStore";
import { marketSymbol, useSelectedMarket } from "../market/useSelectedMarket";

/**
 * Исход ордера — тостом: провал, отмена, которую назвал сервер, истечение,
 * сброс условного ордера (TRM-43).
 *
 * @remarks Слова — `describeOrderOutcome` из SDK; терминал добавляет только
 * подпись ордера (сторона и рынок) из кешей открытых и условных ордеров.
 * Кеш накопительный: исход приходит, когда ордер уже ушёл из открытого
 * списка, — подпись берётся из того, что видели раньше. Ордера в кешах не
 * было (сработавший TP/SL между опросами) — тост без подписи.
 *
 * Дубль `(orderId, status)` гасится здесь, а не в SDK: шлюз зеркалит в канал
 * счёта два броадкаста одного исхода, а устаревание повтор переживает.
 */
export function useOrderOutcomeToasts(): void {
  const accountId = useAccountId();
  const { data: open } = useOpenOrdersQuery(accountId);
  const { data: conditional } = useConditionalOrders();
  const { markets } = useSelectedMarket();
  const push = useToastStore((s) => s.push);

  const known = useRef(new Map<string, GatewayOrder>());
  const shown = useRef(new Set<string>());
  const marketsRef = useRef(markets);

  useEffect(() => {
    for (const order of [...(open ?? []), ...(conditional ?? [])]) {
      known.current.set(order.id, order);
    }
  }, [open, conditional]);

  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);

  useAccountOrderUpdates((update) => {
    const key = `${update.orderId}:${update.status}`;
    if (shown.current.has(key)) return;
    const order = known.current.get(update.orderId);
    const outcome = describeOrderOutcome(update, order);
    if (outcome === null) return;
    shown.current.add(key);
    push({
      id: key,
      ...outcome,
      meta:
        order === undefined
          ? undefined
          : `${order.side} · ${marketSymbol(marketsRef.current, order.marketId)}`,
    });
  });
}
```

Create `src/features/orders/OrderOutcomeToasts.tsx`:

```tsx
import { ToastCard } from "@/components/ui/toast";
import { useToastStore } from "../../stores/useToastStore";
import { useOrderOutcomeToasts } from "./useOrderOutcomeToasts";

/** Тосты исходов ордеров: подписка на поток счёта и сами тосты. */
export function OrderOutcomeToasts() {
  useOrderOutcomeToasts();
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return toasts.map((toast) => (
    <ToastCard
      key={toast.id}
      toast={toast}
      data-testid="order-outcome-toast"
      onOpenChange={(open) => {
        if (!open) dismiss(toast.id);
      }}
    />
  ));
}
```

В `src/App.tsx`:
1. Импорты: `import { ToastProvider, ToastViewport } from "@/components/ui/toast";` и `import { OrderOutcomeToasts } from "./features/orders/OrderOutcomeToasts";`.
2. Обернуть содержимое `MarketProvider` в `<ToastProvider swipeDirection="right">…<ToastViewport /></ToastProvider>` — вьюпорт последним ребёнком провайдера.
3. Первым ребёнком `<SessionGate>` поставить `<OrderOutcomeToasts />` — до тернарника `route.view === "account" ? … : …`, с комментарием: `{/* Вне переключателя страниц: исход ордера виден и на странице счёта. */}`.

Refs читаются только в колбэке `useAccountOrderUpdates` (его зовёт эффект SDK, не рендер) и пишутся в эффектах — правила `react-hooks` это допускают. Если `rtk proxy pnpm lint` всё же ругается правилом `react-hooks/*`, не глушить его `eslint-disable`, а вернуть отчёт `DONE_WITH_CONCERNS` с текстом правила.

- [ ] **Step 6: Подсказка Cancel у `TRIGGERED`**

В `src/features/orders/OpenOrdersTable.tsx` заменить строку `title={…}`:

```tsx
          title={
            r.cancellable
              ? undefined
              : r.order.status === "TRIGGERED"
                ? "Order triggered and is executing — too late to cancel"
                : "Order is settling — too late to cancel"
          }
```

В `src/features/orders/useOpenOrderRows.ts` в TSDoc `cancellable` перечень заменить на «Ордер в полёте (`MATCHED`, `SETTLEMENT_SUBMITTED`, `FAILED_RETRYABLE`, а с SDK 0.64.0 и сработавший условный — `TRIGGERED`)…».

- [ ] **Step 7: e2e — кадры с причиной и спек тостов**

1. `e2e/support/world.ts`, `sseOrderUpdateFrame`:

```ts
/**
 * Кадр SSE `order_update`. По умолчанию — канал ордера `order:{id}`; поток
 * счёта — `channel: "orders:1"` (его слушают тосты исходов). `reason` и
 * `origin` — как на проводе (`OrderUpdateData` из @liq/core).
 */
export function sseOrderUpdateFrame(
  orderId: string,
  status: string,
  opts: { reason?: string; origin?: "pool_execution"; channel?: string } = {},
): string {
  const event = {
    type: "order_update",
    channel: opts.channel ?? `order:${orderId}`,
    data: {
      orderId,
      status,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
    },
  };
  return `data: ${JSON.stringify(event)}\n\n`;
}
```

2. `e2e/pages/TerminalPanels.ts`, в конец файла:

```ts
/** Тосты исходов ордеров — глобальный угол экрана, не панель терминала. */
export class ToastsPanel {
  readonly viewport: Locator;
  readonly outcome: Locator;

  constructor(page: Page) {
    this.viewport = page.getByTestId("toast-viewport");
    this.outcome = page.getByTestId("order-outcome-toast");
  }
}
```

(`Page` и `Locator` в файле уже импортированы — проверить шапку.)

3. Create `e2e/tier1/31-order-outcome-toasts.spec.ts`:

```ts
import { enterTerminal } from "../pages/flows";
import { ToastsPanel } from "../pages/TerminalPanels";
import { MARKET } from "../support/constants";
import { expect, test } from "../support/fixtures";
import {
  conditionalOrderFixture,
  limitOrderFixture,
  readyWorld,
  sseOrderUpdateFrame,
} from "../support/world";

/** Поток счёта `orders:{accountId}`; счёт мока — "1". */
const ACCOUNT_CHANNEL = "orders:1";

test.describe("order outcome toasts", () => {
  test("the terminal listens to the account order stream", async ({ page, world }) => {
    await enterTerminal(page, world, () => readyWorld());
    await expect
      .poll(() => world.sseConnections.flat())
      .toContain(ACCOUNT_CHANNEL);
  });

  test("a failed stop loss shows an error toast and leaves Open Orders", async ({
    page,
    world,
  }) => {
    // TRM-17/TRM-43: тестировщик узнавал о провале только из истории.
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({ conditionalOrders: [conditionalOrderFixture()] }),
    );
    const toasts = new ToastsPanel(page);
    await userInfo.selectTab("open-orders");
    await expect(userInfo.orderRow("ord-cond-1")).toBeVisible();

    world.sseFrames = [
      sseOrderUpdateFrame("ord-cond-1", "FAILED", {
        reason: "no_liquidity",
        channel: ACCOUNT_CHANNEL,
      }),
    ];

    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });
    await expect(toasts.outcome).toContainText("Stop loss failed");
    await expect(toasts.outcome).toContainText("No liquidity to fill it.");
    await expect(toasts.outcome).toContainText(MARKET.symbol);
    // Устаревание из потока счёта: строка не ждёт 60-секундного опроса условных.
    await expect(userInfo.orderRow("ord-cond-1")).toHaveCount(0, { timeout: 15_000 });
  });

  test("the same outcome twice is one toast", async ({ page, world }) => {
    await enterTerminal(page, world, () =>
      readyWorld({ conditionalOrders: [conditionalOrderFixture()] }),
    );
    const toasts = new ToastsPanel(page);
    await expect.poll(() => world.sseConnections.flat()).toContain(ACCOUNT_CHANNEL);

    world.sseFrames = [
      sseOrderUpdateFrame("ord-cond-1", "FAILED", { reason: "no_liquidity", channel: ACCOUNT_CHANNEL }),
      sseOrderUpdateFrame("ord-cond-1", "FAILED", { channel: ACCOUNT_CHANNEL }),
    ];

    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => world.sseFrames.length).toBe(0);
    await expect(toasts.outcome).toHaveCount(1);
  });

  test("a user's own cancel is silent; a sibling cancel explains itself", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () =>
      readyWorld({
        openOrders: [limitOrderFixture()],
        conditionalOrders: [conditionalOrderFixture()],
      }),
    );
    const toasts = new ToastsPanel(page);
    await expect.poll(() => world.sseConnections.flat()).toContain(ACCOUNT_CHANNEL);

    // Голый CANCELLED — так приходят Cancel, Save в TP/SL и Close.
    world.sseFrames = [
      sseOrderUpdateFrame("ord-limit-1", "CANCELLED", { channel: ACCOUNT_CHANNEL }),
    ];
    await expect.poll(() => world.sseFrames.length).toBe(0);
    await expect(toasts.outcome).toHaveCount(0);

    world.sseFrames = [
      sseOrderUpdateFrame("ord-cond-1", "CANCELLED", {
        reason: "sibling_triggered",
        channel: ACCOUNT_CHANNEL,
      }),
    ];
    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });
    await expect(toasts.outcome).toContainText("Stop loss cancelled");
    await expect(toasts.outcome).toContainText("The other leg of the TP/SL pair triggered.");
  });

  test("an order the terminal never saw still gets a toast, without a label", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () => readyWorld());
    const toasts = new ToastsPanel(page);
    await expect.poll(() => world.sseConnections.flat()).toContain(ACCOUNT_CHANNEL);

    world.sseFrames = [
      sseOrderUpdateFrame("ord-unknown", "FAILED", { reason: "brand_new_code", channel: ACCOUNT_CHANNEL }),
    ];

    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });
    await expect(toasts.outcome).toContainText("Order failed");
    await expect(toasts.outcome).toContainText("Reason: brand_new_code");
    await expect(toasts.outcome).not.toContainText(MARKET.symbol);
  });

  test("an error toast stays until dismissed", async ({ page, world }) => {
    await enterTerminal(page, world, () => readyWorld());
    const toasts = new ToastsPanel(page);
    await expect.poll(() => world.sseConnections.flat()).toContain(ACCOUNT_CHANNEL);
    world.sseFrames = [
      sseOrderUpdateFrame("ord-x", "FAILED", { channel: ACCOUNT_CHANNEL }),
    ];
    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });

    await page.waitForTimeout(9_000); // дольше 8 с у не-ошибок
    await expect(toasts.outcome).toHaveCount(1);
    await toasts.outcome.getByRole("button", { name: "Dismiss" }).click();
    await expect(toasts.outcome).toHaveCount(0);
  });

  test("a triggered order is visible in Open Orders and cannot be cancelled", async ({
    page,
    world,
  }) => {
    // TRM-23/TRM-43: до SDK 0.64.0 TRIGGERED не попадал ни в один список.
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({
        openOrders: [conditionalOrderFixture({ id: "ord-trig-1", status: "TRIGGERED" })],
      }),
    );
    await userInfo.selectTab("open-orders");
    await expect(userInfo.orderRow("ord-trig-1")).toBeVisible();
    await expect(userInfo.orderRow("ord-trig-1")).toContainText("TRIGGERED");
    const cancel = page.getByTestId("cancel-order-ord-trig-1");
    await expect(cancel).toBeDisabled();
    await expect(cancel).toHaveAttribute("title", /triggered/);
  });
});
```


Run: `bash /home/alex/tmp/claude-1000/-home-alex-Work-perps-terminal/2fa6167c-643b-4de4-9550-0f1340f86326/scratchpad/e2e-docker.sh e2e/tier1/31-order-outcome-toasts.spec.ts e2e/tier1/11-live-sse.spec.ts e2e/tier1/09-orders-cancel.spec.ts`
Expected: PASS (7 новых + существующие). Проверка, что спек ловит поломку: временно убрать `<OrderOutcomeToasts />` из `App.tsx` — тесты тостов падают, тест TRIGGERED проходит; вернуть.

- [ ] **Step 8: Гейты**

```bash
export PATH="$HOME/.proto/tools/node/24.14.0/bin:$PATH"
rtk proxy pnpm typecheck && rtk proxy pnpm lint && rtk proxy pnpm test && rtk proxy pnpm build
bash /home/alex/tmp/claude-1000/-home-alex-Work-perps-terminal/2fa6167c-643b-4de4-9550-0f1340f86326/scratchpad/e2e-docker.sh
```

Expected: всё зелёное; unit — 173 теста (170 + 3); e2e — базовая линия + 2 (задача 2) + 7.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/stores/useToastStore.ts src/stores/__tests__/useToastStore.test.ts src/components/ui/toast.tsx src/features/orders/useOrderOutcomeToasts.ts src/features/orders/OrderOutcomeToasts.tsx src/App.tsx src/features/orders/OpenOrdersTable.tsx src/features/orders/useOpenOrderRows.ts e2e/support/world.ts e2e/pages/TerminalPanels.ts e2e/tier1/31-order-outcome-toasts.spec.ts
git commit -m "$(cat <<'MSG'
feat(orders): тост на исход ордера и видимый TRIGGERED; SDK 0.64.0 (TRM-43)

Провал, отмена, которую назвал сервер, истечение и сброс TP/SL приходят
тостом: поток счёта orders:{accountId} из useAccountOrderUpdates, слова —
describeOrderOutcome из SDK, подпись ордера — из кешей. Голый CANCELLED
(отмена самим пользователем) молчит, дубль исхода — один тост, ошибка
висит до закрытия. Сработавший условный ордер виден в Open Orders с
погашенной отменой.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 10: Push и draft-PR**

```bash
git branch --show-current   # feat-cld/f1-visibility
git push -u origin feat-cld/f1-visibility
gh pr create --draft --title "feat: исходы ордеров тостом, ошибки словами, гейт Repay; SDK 0.64.0 (TRM-43, TRM-42, TRM-29)" --body "$(cat <<'MSG'
Фаза Ф1 «Видимость». Спека: `docs/superpowers/specs/2026-10-04-f1-visibility-design.md`. SDK-часть: liqcx/monorepo — PR `feat-cld/f1-order-outcomes` (0.64.0).

- SDK 0.57.0 → 0.64.0: скобки через `bracketsPlanFor` (0.58.0), размер позиции знаковый (0.63.0).
- Тост на исход ордера (TRM-43): FAILED, CANCELLED с причиной от сервера, EXPIRED, TRIGGER_DROPPED; голый CANCELLED (отмена пользователем) молчит; ошибка висит до закрытия. Сработавший TP/SL (`TRIGGERED`) виден в Open Orders, отменить нельзя.
- Ошибки через `humanizeError` в семи местах вместо сырого `error.message` (TRM-42; текст TRM-1 и TRM-31).
- Repay & Withdraw гаснет, когда USDC кошелька меньше долга, и говорит, сколько нужно (TRM-29).

Plane: TRM-43, TRM-42, TRM-29. В TRM-1 и TRM-31 исправлен только текст ошибки — причины разбираются в Ф0.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
MSG
)"
```

Expected: ссылка на PR.
