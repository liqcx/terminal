import {
  useAccountDebtQuery,
  useAccountId,
  useAccountMargin,
  useAvailableMarginQuery,
  useEnrichedPositions,
  useMarginUsage,
} from "@liq/react";

import { useSelectedMarket } from "../market/useSelectedMarket";

const WAD = 10n ** 18n;

/** Ровно то, что панели нужно знать о позиции. */
interface SummaryPosition {
  unrealizedPnl: bigint;
  notional: bigint;
}

interface SummaryInput {
  /** `getAvailableMargin` — залог, переоценённый по марку. `undefined` = не прочитано. */
  available: bigint | undefined;
  /** `useMarginUsage().data.usage`, WAD; `undefined` — нет чтения или счёт под водой. */
  usage?: bigint;
  /** Офчейн-лок под неурегулированные филлы. `undefined` = шлюз не прочитан (нет входа, загрузка, ошибка). */
  locked: bigint | undefined;
  /** `free` шлюза = `available − locked`; может быть отрицательным. */
  free?: bigint;
  debt: bigint;
  positions: SummaryPosition[];
}

interface AccountSummary {
  unrealizedPnl: bigint;
  accountValue: bigint | undefined;
  /** Решение 3 (TRM-40): equity = available. Офчейн-лок не вычитается. */
  equity: bigint | undefined;
  /** Офчейн-лок под открытые ордера — отдельной строкой «In orders». */
  inOrders: bigint | undefined;
  borrowed: bigint;
  exposure: bigint;
  /** WAD-кратность. `undefined`, когда стоимость счёта неизвестна или неположительна. */
  leverage: bigint | undefined;
  /** Доступно для новых ордеров по мнению шлюза. */
  free: bigint | undefined;
  /** Требуемая начальная маржа / available, WAD; `undefined` — «—». */
  marginUsage: bigint | undefined;
}

/**
 * Девять полей панели из пяти чтений (available, позиции, маржа шлюза, usage, долг).
 *
 * @remarks Чистая функция — вся её работа складывать и делить уже посчитанное:
 * `unrealizedPnl` и `notional` приходят из `enrichPosition`, `available` из
 * `getAvailableMargin`. Ни одна величина здесь не выводится заново.
 *
 * `undefined` вместо нуля там, где чтение не состоялось: обнулившийся счёт и
 * непрочитанный счёт — разные вещи, и на экране кризиса их путать нельзя.
 */
export function summarize(input: SummaryInput): AccountSummary {
  const unrealizedPnl = input.positions.reduce(
    (sum, p) => sum + p.unrealizedPnl,
    0n,
  );
  const exposure = input.positions.reduce((sum, p) => sum + p.notional, 0n);
  const accountValue = input.available;
  const equity = accountValue;
  const leverage =
    accountValue === undefined || accountValue <= 0n
      ? undefined
      : (exposure * WAD) / accountValue;
  return {
    unrealizedPnl,
    accountValue,
    equity,
    inOrders: input.locked,
    borrowed: input.debt,
    exposure,
    leverage,
    free: input.free,
    marginUsage: input.usage,
  };
}

/**
 * Панель Account поверх пяти чтений SDK.
 *
 * @remarks Маржа шлюза — `useAccountMargin`, использование —
 * `useMarginUsage`: те же записи кэша, что у тикета. SDK помечает устаревшей
 * маржу шлюза на `orderStateChanged` и прочих событиях ордеров, а usage — на
 * orderSubmitted / orderCancelled / orderSettled и deposited / repaid /
 * withdrawn.
 *
 * Долг с SDK 0.56.0 читает `useAccountDebtQuery` — одна запись кэша на панель,
 * диалог вывода и протухание после расчёта или погашения.
 */
export function useAccountSummary(): {
  summary: AccountSummary;
  isLoading: boolean;
} {
  const accountId = useAccountId();
  const { allMarketIds } = useSelectedMarket();

  const { data: margins, isLoading: marginsLoading } = useAvailableMarginQuery();
  const { data: positions = EMPTY } = useEnrichedPositions(allMarketIds);

  const { data: gatewayMargin } = useAccountMargin(accountId);
  const { data: marginUsage } = useMarginUsage(accountId);

  const { data: debt } = useAccountDebtQuery();

  return {
    summary: summarize({
      available: margins?.available,
      usage: marginUsage?.usage,
      locked: gatewayMargin?.locked,
      free: gatewayMargin?.free,
      debt: debt ?? 0n,
      positions: positions.map((p) => ({
        unrealizedPnl: p.unrealizedPnl,
        notional: p.notional,
      })),
    }),
    isLoading: marginsLoading,
  };
}

const EMPTY: { unrealizedPnl: bigint; notional: bigint }[] = [];
