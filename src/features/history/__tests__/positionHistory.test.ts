import type { PositionEpisode } from "@liq/api-client";
import { describe, expect, it } from "vitest";

import { newestFirst } from "../positionHistory";

const episode = (
  marketId: bigint,
  openedAt: number,
  closedAt: number,
): PositionEpisode => ({
  marketId,
  symbol: null,
  direction: "long",
  openedAt,
  closedAt,
  avgEntryPrice: 1n,
  avgClosePrice: 2n,
  maxSize: 3n,
  realizedPnl: 4n,
  feesUsd: 5n,
  closedBy: "trade",
  liquidationPrice: null,
  openInferred: false,
  liquidationTouched: false,
  sizeDiverged: false,
});

const key = (e: PositionEpisode) => `${e.marketId}:${e.openedAt}:${e.closedAt}`;

describe("Position History — новые сверху", () => {
  it("разворачивает порядок шлюза (по закрытию, старые первыми)", () => {
    const server = [
      episode(100n, 1_000, 1_100),
      episode(200n, 1_050, 1_200),
      episode(400n, 1_150, 1_300),
    ];
    expect(newestFirst(server).map(key)).toEqual([
      "400:1150:1300",
      "200:1050:1200",
      "100:1000:1100",
    ]);
  });

  it("решает closedAt, а не openedAt, когда они расходятся", () => {
    // Открыт раньше, закрыт позже — всё равно наверху: порядок по закрытию.
    const server = [episode(200n, 1_100, 1_200), episode(100n, 1_000, 1_300)];
    expect(newestFirst(server).map(key)).toEqual([
      "100:1000:1300",
      "200:1100:1200",
    ]);
  });

  it("при равном closedAt выше тот, что открыт позже", () => {
    const server = [episode(100n, 1_000, 2_000), episode(200n, 1_500, 2_000)];
    expect(newestFirst(server).map(key)).toEqual([
      "200:1500:2000",
      "100:1000:2000",
    ]);
  });

  it("при равных closedAt и openedAt — по marketId, независимо от входа", () => {
    const a = episode(1800n, 1_000, 2_000);
    const b = episode(7100n, 1_000, 2_000);
    expect(newestFirst([b, a]).map(key)).toEqual([
      "1800:1000:2000",
      "7100:1000:2000",
    ]);
    expect(newestFirst([a, b]).map(key)).toEqual([
      "1800:1000:2000",
      "7100:1000:2000",
    ]);
  });

  it("не трогает массив из кэша запроса", () => {
    const server = [episode(100n, 1_000, 1_100), episode(200n, 1_050, 1_200)];
    newestFirst(server);
    expect(server.map(key)).toEqual(["100:1000:1100", "200:1050:1200"]);
  });
});
