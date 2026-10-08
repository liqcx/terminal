import { enterTerminal } from "../pages/flows";
import { MARKET, MARKET_ETH, WAD } from "../support/constants";
import { expect, test } from "../support/fixtures";
import {
  ledgerRowFixture,
  positionEpisodeFixture,
  readyWorld,
  settledOrderFixture,
  tradeFixture,
} from "../support/world";

test.describe("истории нижней панели", () => {
  test("история ордеров показывает исполненный ордер, а не открытый", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({ orderHistory: [settledOrderFixture()] }),
    );

    await userInfo.selectTab("order-history");
    const row = page.getByTestId("order-history-table-row-ord-filled-1");
    await expect(row).toBeVisible();
    await expect(row).toContainText("SETTLED");
  });

  test("история позиций рисует закрытый эпизод", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({
        positionHistory: {
          available: true,
          episodes: [positionEpisodeFixture()],
        },
      }),
    );

    await userInfo.selectTab("position-history");
    const row = page.getByTestId(
      `position-history-table-row-${MARKET.id}-1717200000`,
    );
    await expect(row).toBeVisible();
    await expect(row).toContainText("Long");
    await expect(row).toContainText("Trade");
  });

  test("история позиций ставит последний закрытый эпизод наверх", async ({
    page,
    world,
  }) => {
    // Шлюз отдаёт эпизоды в порядке закрытия, старые первыми. Второй эпизод
    // открыт позже и закрыт позже — он и должен оказаться первой строкой.
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({
        positionHistory: {
          available: true,
          episodes: [
            positionEpisodeFixture({
              openedAt: 1_717_200_000,
              closedAt: 1_717_203_600,
            }),
            positionEpisodeFixture({
              openedAt: 1_717_210_000,
              closedAt: 1_717_213_600,
            }),
          ],
        },
      }),
    );

    await userInfo.selectTab("position-history");
    const rows = page.locator('[data-testid^="position-history-table-row-"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute(
      "data-testid",
      `position-history-table-row-${MARKET.id}-1717210000`,
    );
  });

  test("молчащий индексатор отличается от пустой истории", async ({
    page,
    world,
  }) => {
    // `available: false` — «событий этого счёта у индексатора нет вовсе».
    // Показать здесь «закрытых позиций нет» значило бы утверждать знание,
    // которого нет.
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({ positionHistory: { available: false, episodes: [] } }),
    );

    await userInfo.selectTab("position-history");
    await expect(page.getByTestId("position-history-unavailable")).toBeVisible();
    await expect(page.getByTestId("position-history-table-empty")).toHaveCount(
      0,
    );
  });

  test("леджер счёта показывает строку расчёта", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({ settlementLedger: [ledgerRowFixture()] }),
    );

    await userInfo.selectTab("account-history");
    await expect(page.getByTestId("account-history-table")).toBeVisible();
    await expect(page.getByTestId("account-history-table")).toContainText(
      "Settlement",
    );
  });

  test("фандинг берёт из леджера только платежи и не выдумывает ставку", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({
        settlementLedger: [
          ledgerRowFixture(),
          ledgerRowFixture({ logIndex: 4, accruedFunding: "0" }),
        ],
      }),
    );

    await userInfo.selectTab("funding-history");
    const rows = page.locator('[data-testid^="funding-history-table-row-"]');
    // Двух строк в леджере, платёж один — нулевой фандинг не платёж.
    await expect(rows).toHaveCount(1);
    // Колонка Rate — прочерк: ставки на момент платежа нет ни в одном источнике.
    await expect(rows.first().locator("td").nth(3)).toHaveText("—");
  });

  test("скрытая колонка исчезает из таблицы", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({ trades: [tradeFixture()] }),
    );

    await userInfo.selectTab("trade-history");
    await expect(userInfo.header("price")).toBeVisible();
    await userInfo.columnsButton.click();
    await userInfo.columnToggle("price").click();
    await expect(userInfo.header("price")).toHaveCount(0);
  });

  test("фильтр по рынку оставляет строки одного рынка", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({
        markets: [MARKET, MARKET_ETH],
        trades: [
          tradeFixture(),
          tradeFixture({ id: "fill-eth", marketId: MARKET_ETH.id }),
        ],
      }),
    );

    await userInfo.selectTab("trade-history");
    await expect(userInfo.tradeRow("fill-1")).toBeVisible();
    await expect(userInfo.tradeRow("fill-eth")).toBeVisible();

    await userInfo.filterButton.click();
    await userInfo.filterOption(MARKET_ETH.id).click();

    await expect(userInfo.tradeRow("fill-eth")).toBeVisible();
    await expect(userInfo.tradeRow("fill-1")).toHaveCount(0);
  });

  test("клик по шапке переставляет строки", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({
        trades: [
          tradeFixture({ id: "fill-cheap", price: (60_000n * WAD).toString() }),
          tradeFixture({ id: "fill-rich", price: (80_000n * WAD).toString() }),
        ],
      }),
    );

    await userInfo.selectTab("trade-history");
    const rows = page.locator('[data-testid^="trade-history-table-row-"]');
    // Числовая колонка в react-table идёт desc-first: первый клик ставит
    // наверх дорогую сделку, второй переворачивает.
    await userInfo.header("price").click();
    await expect(rows.first()).toHaveAttribute(
      "data-testid",
      "trade-history-table-row-fill-rich",
    );
    await userInfo.header("price").click();
    await expect(rows.first()).toHaveAttribute(
      "data-testid",
      "trade-history-table-row-fill-cheap",
    );
  });
});
