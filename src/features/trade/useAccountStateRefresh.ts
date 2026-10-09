import { useLiqQueryKeys } from "@liq/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { type AccountState, foldAccountState } from "./orderMarginView";

/**
 * Сбрасывает кэш превью ордера аккаунта, когда меняется состояние счёта.
 *
 * @remarks Обход SDK 0.67.0: срез `orderMarginPreview` не помечается устаревшим
 * ничем (`dirtiedBy: []`, `refetchInterval` нет), а R0 перечитывается. Решение
 * «изменился ли счёт» (R0, `locked`, коллатерал, долг) — {@link foldAccountState}. Префикс ключа берётся из
 * фабрики SDK: ключ среза — `["liq", "orderMarginPreview", networkId, accountId,
 * marketId, sizeDelta, price, orderCost]` (liq-core, `liqSlices.orderMarginPreview`:
 * scope `networkId, accountId, marketId`, params `sizeDelta, price, orderCost`),
 * поэтому отбрасывание хвоста из четырёх элементов оставляет префикс аккаунта по
 * всем рынкам. Удалить после того, как SDK пометит срез `dirtiedBy` событий счёта.
 *
 * Сброс не двигает R0 и `locked` — это другие запросы, — так что петли нет.
 * Смена аккаунта — не изменение счёта: у другого аккаунта другой ключ.
 */
export function useAccountStateRefresh(
  accountId: bigint | undefined,
  state: AccountState,
): void {
  const queryClient = useQueryClient();
  const keys = useLiqQueryKeys();
  const seen = useRef<
    { accountId: bigint | undefined; state: AccountState } | undefined
  >(undefined);
  const { r0, locked, collateral, debt } = state;

  useEffect(() => {
    const last = seen.current;
    const prev =
      last !== undefined && last.accountId === accountId
        ? last.state
        : undefined;
    const step = foldAccountState(prev, { r0, locked, collateral, debt });
    seen.current = { accountId, state: step.state };
    if (!step.changed || accountId === undefined) return;
    void queryClient.invalidateQueries({
      queryKey: keys
        .orderMarginPreview(accountId.toString(), "", "", "", "")
        .slice(0, -4),
    });
  }, [accountId, r0, locked, collateral, debt, queryClient, keys]);
}
