import type { PositionEpisode } from "@liq/api-client";

/**
 * Эпизоды Position History, новые сверху.
 *
 * @remarks Шлюз отдаёт `/position-history` в порядке закрытия (старые первыми)
 * и без пагинации — свёртка на сервере обязана идти по возрастанию, поэтому
 * разворот делается здесь. Равные `closedAt` (одна секунда) разводятся по
 * `openedAt` (новее выше), затем по `marketId` — порядок не зависит от того,
 * в каком виде пришёл массив.
 */
export function newestFirst(
  episodes: readonly PositionEpisode[],
): PositionEpisode[] {
  return [...episodes].sort(
    (a, b) =>
      b.closedAt - a.closedAt ||
      b.openedAt - a.openedAt ||
      (a.marketId < b.marketId ? -1 : a.marketId > b.marketId ? 1 : 0),
  );
}
