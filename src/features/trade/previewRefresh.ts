import type { QueryClient, QueryKey } from "@tanstack/react-query";

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
 * Читается в рендере, на тот же `isFetching`, что и вызывающий: протухание
 * и старт перечитывания идут подряд, а завершение сбрасывает оба флага разом.
 * Ключ должен совпадать с ключом хука `useOrderMarginPreview`; SDK пока не
 * отдаёт флаг `refreshing` сам — это следующий шаг на стороне SDK, после него
 * этот файл удаляется.
 */
export function isInvalidationRefetch(
  queryClient: QueryClient,
  key: QueryKey,
  isFetching: boolean,
  hasData: boolean,
): boolean {
  if (!isFetching || !hasData) return false;
  return queryClient.getQueryState(key)?.isInvalidated === true;
}
