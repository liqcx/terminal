# Терминал на SDK 0.68 — без своего сброса превью маржи (MR-116) — план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, одна задача
> на диспатч, ревью после каждой. State: `.claude/plans/2026-10-10-sdk-068-preview-cleanup/`.

**Plane:** MR-116 (SDK-часть — liqu-fi/monorepo#901, опубликована `liq@0.68.0`). Близнец — liqu-web.
**Branch:** `feat-cld/sdk-068-preview` от `origin/main`. PR — draft в `main`.

**Goal:** терминал ставит `@liqpro/*` 0.68.0, где срез `orderMarginPreview` сам протухает от
`orderSettled` / `deposited` / `withdrawn` / `repaid` и перечитывается раз в 10 с, и удаляет свой
обход — `useAccountStateRefresh` и чистые `accountStateChanged` / `foldAccountState`.

## Global Constraints

- SDK `@liqpro/*` — ровно 0.68.0 во всех пяти зависимостях `package.json:21-25`. Node 24.14.0
  (`export PATH=$HOME/.proto/tools/node/24.14.0/bin:$PATH`), pnpm из `.prototools`.
- В 0.68.0 ключ превью — `['liq','account',net,wallet,'orderMarginPreview', accountId, marketId, …]`
  (scope кошелька); `useLiqQueryKeys().orderMarginPreview` теперь принимает `wallet` первым
  аргументом — старый вызов в `useAccountStateRefresh.ts:44` не скомпилируется.
- Удержание цифр и тусклость при перечитывании (`holdPreviewStep(…, refreshing)`,
  `heldPreviewKey`) **остаются**: SDK по-прежнему перечитывает запись с данными, и без этого
  строки показали бы старый R1 без пометки.
- Гейты: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`. Известный флак:
  `e2e/tier1/28-position-actions.spec.ts:265`.
- Коммиты через хук, `git commit -F`, никогда `--no-verify`; `.claude/active-plan` не стейджить.
  Всякая команда `gh pr …` — с номером и `--repo liqcx/terminal`.

## Review Focus

1. После филла при том же размере/цене Margin пересчитывается (e2e 07 «после филла…») — теперь
   через событие `orderSettled` / таймер SDK, а не через свой сброс.
2. После депозита Liq. Price обновляется (e2e 07 «депозит…») — через `deposited` SDK.
3. Строки тускнеют, пока SDK перечитывает запись (e2e «сброс превью … тусклы» или его замена).
4. Нет остатков: `git grep -n "useAccountStateRefresh\|accountStateChanged\|foldAccountState\|orderMarginPreview(" -- src e2e` пусто, кроме моков цепи.
5. Гость/без кошелька — превью выключено (SDK `enabled && !!wallet`), тикет показывает «—».

---

### Task 1: бамп SDK 0.68.0 и удаление `useAccountStateRefresh`

**Files:**
- Modify: `package.json:21-25` → `^0.68.0`; `pnpm install` (lockfile).
- Delete: `src/features/trade/useAccountStateRefresh.ts`.
- Modify: `src/features/trade/useOrderSizing.ts` — убрать вызов хука и чтения, нужные только ему
  (коллатераль `useCollateralBalances().totalWad`, долг `useAccountDebtQuery`, проброс `locked` из
  `TradeForm` — если `locked` больше никому не нужен); `src/features/trade/orderMarginView.ts` —
  удалить `accountStateChanged`, `foldAccountState`, тип `AccountState`, их TSDoc; оставить
  `holdPreviewStep`/`refreshing`/`heldPreviewKey`.
- Modify: `src/features/trade/__tests__/orderMarginView.test.ts` — удалить тесты удалённых функций.
- Modify: `e2e/tier1/07-trade-gating.spec.ts:389-440` — регрессии «после филла» и «депозит» должны
  оставаться зелёными **без** своего сброса. Филл: если мок шлюза умеет слать в SSE переход ордера
  в SETTLED/`orderSettled` для аккаунта — тест вызывает его; иначе опирается на таймер SDK
  (`page.clock.runFor(10_000 + запас)`) и в TSDoc теста сказано, какой путь он проверяет. Депозит —
  через диалог (событие `deposited` уже есть).
- Modify: `e2e/support/chain.ts` (мок `orderMarginPreview`, если ключ где-то строится по старой
  форме), тело PR — follow-up строка про SDK заменяется фактом «превью сбрасывает SDK 0.68».

- [ ] **Step 1:** бамп, `pnpm install`, `pnpm typecheck` — ожидаемо красный на
  `useAccountStateRefresh.ts` (подтверждает ломающий ключ); записать вывод в отчёт.
- [ ] **Step 2:** удалить хук и чистые функции, почистить `useOrderSizing`/`TradeForm`, тесты.
  `git grep` из Review Focus 4 — пусто.
- [ ] **Step 3:** e2e 07 — оба регрессионных теста зелёные без своего сброса; тест тусклости —
  зелёный (если он держался на своём сбросе — переписать на событие/таймер SDK).
- [ ] **Step 4:** гейты (все пять). Пробы: (a) в e2e филла убрать событие/прогон таймера →
  красный; (b) `refreshing` → `false` в `useOrderSizing` → тест тусклости красный.
- [ ] **Step 5:** коммит, push, draft PR в `main` (`gh pr create --draft --repo liqcx/terminal
  --base main`): русское описание, MR-116, что удалено и почему, футер
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

**Done:** терминал на 0.68.0, своего сброса превью нет, регрессии филла и депозита зелёные, PR открыт.
