# Ф1 · Видимость: исходы ордеров и понятные ошибки — дизайн

Дата: 2026-10-04. Фаза Ф1 модуля Plane «Ф1 · Видимость» проекта TRM. Закрывает TRM-42, TRM-43, TRM-29;
в TRM-1 и TRM-31 исправляет только текст ошибки (причины — в Ф0, по логам).

## Зачем

В шести репортах (TRM-2, 7, 10, 17, 20, 23) тестировщик узнаёт о FAILED и CANCELLED только из Order History:
тоста нет. Сработавший TP/SL в статусе `TRIGGERED` не попадает ни в один список терминала и «исчезает».
Ошибки печатаются сырым `error.message`: wei в «Insufficient margin», «simulation failed: Execution reverted for an
unknown reason», внутренний id счёта в «registered to a different wallet». Пока это так, ни одну починку исполнения
ордеров (Ф2, Ф3) нельзя перепроверить: исход невидим.

## Что на проводе (проверено по коду 2026-10-04)

- `TRIGGERED` — промежуточный статус **того же** ордера: `TRIGGER_PENDING → TRIGGERED → MATCHED | PARTIALLY_FILLED |
  FAILED` (`packages/types/src/order-transitions.ts:100-123`). Ребра в `CANCELLED` нет — отменить нельзя.
- Шлюз зеркалит каждый `order_update` в приватный канал счёта `orders:{accountId}`
  (`apps/order-gateway/src/websocket/event-handlers.controller.ts:124-137`). Клиент SSE уже умеет приватные каналы
  с токеном (`packages/liq-api-client/src/sse.ts:179`). Ни один хук liq-react на этот канал не подписан; терминал
  подписан только на `order:{id}` открытых ордеров (`src/features/userinfo/useLiveOrders.ts`) — TP/SL в
  `TRIGGER_PENDING` не слушает никто.
- `OrderUpdateData.reason` (`packages/liq-core/src/types/fill.ts:37-65`): у FAILED — код отказа движка
  (`no_liquidity`, `reduce_only_no_position`, `reduce_only_would_increase`, `reduce_only_reserve_covers_position`,
  `post_only_would_cross`, `fok_unfillable`, `circuit_halted_volatility`, `circuit_halted_stale_oracle`,
  `circuit_limit_only`, `stale_retry_exhausted`, `backpressure`) или `liquidated`; у CANCELLED — только
  `sibling_triggered`. `origin: 'pool_execution'` — лимитка переложена в синтетический пуловый MARKET.
  Источник — `statusDiscriminators` в `apps/event-processor/src/applier/effects/order-status-broadcast.effect.ts:33-82`.
- **Отмена пользователем приходит голой**: CANCELLED без `reason` и без `origin`. Так же приходят отмены старых ног
  при Save в диалоге TP/SL и снятие скобок кнопкой Close. В REST-ответе ордера причины нет вовсе
  (`GatewayOrder`, `packages/liq-core/src/types/order.ts:68-86`) — только в SSE.
- `humanizeError` (`packages/liq-core/src/errors/humanize.ts:173`) уже разбирает margin-отказ шлюза в доллары
  (регулярка без якоря — находит строку и внутри многострочного текста), отказ в кошельке, нехватку газа; остальное
  прогоняет через таблицу `ERROR_PATTERNS` (`errors/format.ts`). В таблице нет «registered to a different wallet» и
  «execution reverted for an unknown reason». В терминале `humanizeError` зовёт только `TurnkeyLoginButton`.
- Repay & Withdraw гасит долг из **USDC кошелька** (терминал не передаёт `repayFromSUSDC`); диалог баланс кошелька
  не читает. `useDepositableBalance(symbol).data.token` — баланс токена в WAD.

## Решения

1. **`TRIGGERED` — ордер в полёте.** Добавляется в `IN_FLIGHT_ORDER_STATUSES` (liq-core). Следствия: его отдаёт
   `useOpenOrdersQuery`, Cancel гаснет через `isInFlight`, деление статусов на три набора теперь «все, кроме
   `TRIGGER_PENDING`». В список условных (`useConditionalOrders`) **не** добавляется: поиск скобок позиции
   (`liq-core positions/brackets.ts`) читает этот список, и редактор TP/SL принялся бы отменять неотменяемый ордер.
2. **Слова исхода — в SDK.** `describeOrderOutcome(update, order?)` в liq-core: статус + `reason`/`origin` → `null`
   (тоста не нужно) или `{ tone, title, detail }`. Терминал только печатает. Так же, как скобки (`describeBracket*`).
   - FAILED — всегда тост (`tone: 'error'`), с `detail` по коду или общим текстом без кода.
   - CANCELLED — тост **только при `reason`** (`tone: 'info'`). Голый CANCELLED — действие самого пользователя:
     тоста нет. `origin: 'pool_execution'` — это исполнение, а не исход: тоста нет.
   - EXPIRED, TRIGGER_DROPPED — тост `tone: 'warning'`.
   - Остальные статусы (в т. ч. SETTLED, TRIGGERED, MATCHED) — `null`.
   - Неизвестный код причины — общий заголовок и `detail: "Reason: <code>"`; функция не бросает (движок уже
     добавлял коды — 3057384e добавил восемь).
3. **Поток исходов — один хук liq-react.** `useAccountOrderUpdates(onUpdate?)` подписывается на
   `sseChannel.orders(accountId)` и на каждое `order_update`: зовёт колбэк с полным `OrderUpdateData` (с `reason`,
   `origin`) и объявляет устаревание тем же контрактом, что `useSseOrderUpdates` (`orderSettled` на SETTLED/MATCHED,
   иначе `orderStateChanged`) — иначе строка упавшего TP/SL висела бы в Open Orders до 60-секундного опроса.
   Хук события не дедуплицирует (PARTIALLY_FILLED законно повторяется); дедупликация тостов — в терминале.
4. **Тексты ошибок — в SDK.** В `ERROR_PATTERNS` добавляются две строки: «registered to a different wallet» →
   «This trading account belongs to a different wallet. Sign in with the wallet that created it.»;
   «execution reverted for an unknown reason» → «The transaction would fail on-chain. Check your wallet balance and
   try again.».
5. **Терминал печатает `humanizeError` везде**, где сейчас сырой текст: `TradeForm`, `TpSlDialog`,
   `CollateralAmountDialog`, `PositionsTable`, `FaucetDialog` (два места), `SessionCta.ErrorLine` (по умолчанию —
   покрывает создание счёта, вход в шлюз, смену сети).
6. **Repay & Withdraw проверяется до подачи.** При долге диалог читает баланс USDC кошелька; если он меньше долга —
   кнопка гаснет, строка объясняет: «Not enough USDC in your wallet to repay the $X debt (wallet: $Y). Top up the
   wallet first.». Пока баланс не пришёл — не гасим (молчащий RPC отдаёт нули; ложная блокировка хуже ревёрта с
   понятным текстом из п. 4).
7. **Тостер — Radix Toast** из уже подключённого `radix-ui` (`@radix-ui/react-toast` внутри), без новой зависимости.
   Тосты исходов: `useOrderOutcomeToasts` в терминале — `useAccountOrderUpdates` + `describeOrderOutcome` +
   дедупликация по `(orderId, status)`; подпись ордера (тип, сторона, рынок) — из кешей открытых и условных ордеров,
   если ордер там есть; нет — тост без подписи.
8. **SDK-релиз — 0.64.0, без деплоя.** Меняются только `packages/liq-*`; шлюз не трогается. Терминал сначала
   переходит на опубликованный 0.63.0 (миграция API скобок из 0.58.0), затем на 0.64.0.
   Спаривание TP/SL опирается на решение 3 ADR-0071 шлюза (`LinkedGroups.join`): с SDK 0.62 у ног скобок нет
   `groupId`, связку выбирает шлюз. Оно есть на monorepo `staging` (деплой 2026-10-02) и отсутствует в `origin/main`:
   production-сборку нельзя направлять на шлюз старше monorepo staging→main.

## Не делаем

- Не заменяем `useLiveOrders` (подписка на `order:{id}`) потоком счёта: e2e-кадры адресованы `order:{id}`, а
  двойное объявление устаревания безвредно. Свести к одному потоку — отдельная задача.
- Не добавляем тост на SETTLED и TRIGGERED: исполнение видно в позициях, срабатывание — строкой в Open Orders.
- Не восполняем пропущенные события после разрыва SSE: тост — подсказка, история остаётся источником правды.
- Причину отказа в REST-ответ ордера не добавляем (это шлюз и деплой — вне Ф1).
