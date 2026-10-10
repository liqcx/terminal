import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Идёт ли перечитывание превью, вызванное протуханием среза (`invalidateQueries`).
 *
 * @remarks SDK 0.68 протуханием помечает срез по событию (`orderSettled`,
 * `deposited`, `withdrawn`, `repaid`) через `invalidateQueries`; TanStack
 * ставит запросу `isInvalidated`, пока перечитывание не кончится успехом. 10-секундный
 * таймер хука (`refetchInterval`) этого флага не ставит: он перечитывает ту же
 * цифру, и тусклить её на каждый такт нечего. `isFetching` без `isInvalidated`
 * — таймер, и цифры остаются яркими.
 *
 * Флаг читается подпиской на кэш запросов, а не в рендере: событие SDK во
 * время идущего такта не меняет ни `fetchStatus`, ни признак устарелости, рендера не
 * будет, и строки остались бы яркими до чужого рендера.
 * Ключ должен совпадать с ключом хука `useOrderMarginPreview`; SDK пока не
 * отдаёт флаг `refreshing` сам — это следующий шаг на стороне SDK, после него
 * этот файл удаляется.
 */
export function useInvalidationRefetch(
  queryClient: QueryClient,
  key: QueryKey,
  isFetching: boolean,
  hasData: boolean,
): boolean {
  const cache = queryClient.getQueryCache();
  // Ключ приходит новым массивом на каждый рендер; подписка от него не зависит,
  // снимок — булево, ссылка не важна.
  const subscribe = useCallback(
    (notify: () => void) => cache.subscribe(notify),
    [cache],
  );
  const invalidated = useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryState(key)?.isInvalidated === true,
  );
  return isFetching && hasData && invalidated;
}
