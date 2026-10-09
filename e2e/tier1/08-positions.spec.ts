import { MARKET, MARKET_ETH, WAD } from "../support/constants";
import { AppPage } from "../pages/AppPage";
import { enterTerminal } from "../pages/flows";
import { UserInfoPanel } from "../pages/TerminalPanels";
import { expect, seed, test } from "../support/fixtures";
import {
  armHold,
  longPositionFixture,
  readyWorld,
  releaseHold,
} from "../support/world";

test.describe("positions", () => {
  test("renders an open position row", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      return w;
    });

    await userInfo.selectTab("positions");
    await expect(userInfo.positionsTable).toBeVisible();
    const row = userInfo.positionRow("200");
    await expect(row).toBeVisible();
    await expect(row).toContainText("BTC");
    // Columns (макет, 11 штук): Market=0, Side=1, Value/Size=2, Entry=3,
    // Mark=4, Liq=5, Margin=6, Funding=7, uPnL=8, rPnL=9, TP/SL=10. Каждая
    // проверка привязана к своей ячейке, чтобы цену входа не удовлетворило
    // совпадающее значение из соседней колонки.
    // entryPrice = indexPrice - (totalPnl - accruedFunding)/size = 70,000 - 100/1
    await expect(row.locator("td").nth(3)).toHaveText("69,900");
    // uPnL is positive ⇒ +$100.00 in the long (green) color. Ячейка несёт две
    // строки — сумму и процент, — поэтому цвет проверяется на самой сумме.
    await expect(row.locator("td").nth(8)).toContainText("+$100.00");
    await expect(row.locator("td").nth(8).locator("span").first()).toHaveClass(
      /text-long/,
    );
  });

  test("колонка маржи называется «Req. margin», объясняет себя подсказкой; бейджа плеча нет", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      return w;
    });

    await userInfo.selectTab("positions");
    // Заголовок на месте прежней колонки Margin (индекс 6), индексы не сдвинуты.
    const header = page.getByTestId("table-header-margin");
    await expect(header).toHaveText("Req. margin");
    await expect(userInfo.positionsTable.locator("th").nth(6)).toHaveText(
      "Req. margin",
    );

    await header.getByTestId("positions-req-margin-header").hover();
    await expect(page.getByRole("tooltip").first()).toHaveText(
      "Initial margin the protocol requires for this position — a size- and skew-dependent share plus the liquidation reward",
    );

    // Плечо позиции (TRM-12: notional / available аккаунта) не показывается:
    // в ячейке стороны остаётся одно слово.
    await expect(
      userInfo.positionRow("200").locator("td").nth(1),
    ).toHaveText("Long");
  });

  test("shows the empty state with no positions", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world);
    await userInfo.selectTab("positions");
    await expect(userInfo.positionsEmpty).toBeVisible();
  });

  test("renders a short position with the short badge and color", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      // negative positionSize ⇒ short side (the long fixture is +WAD)
      w.accounts[0].positions = [
        longPositionFixture({ positionSize: -WAD, totalPnl: -50n * WAD }),
      ];
      return w;
    });

    await userInfo.selectTab("positions");
    const row = userInfo.positionRow("200");
    await expect(row).toBeVisible();
    await expect(row).toContainText("BTC");
    // Сторону называет бейдж в своей колонке, а не глиф рядом с тикером.
    await expect(row.locator("td").nth(1)).toContainText("Short");
    await expect(
      row.locator("td").nth(1).locator("span span").first(),
    ).toHaveClass(/text-short/);
    // Размер по-прежнему без знака: бейдж и цвет уже сказали «шорт», знак
    // удвоил бы отрицание.
    await expect(row.locator("td").nth(2)).toContainText("≈ 1");
  });

  test("renders positions across multiple markets", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld({ markets: [MARKET, MARKET_ETH] });
      w.accounts[0].positions = [
        longPositionFixture({ marketId: "200" }), // BTC long
        longPositionFixture({
          marketId: "201", // ETH short
          positionSize: -WAD,
          totalPnl: -25n * WAD,
        }),
      ];
      return w;
    });

    await userInfo.selectTab("positions");
    // both rows render with the right symbol (keyed on a unique marketId)
    await expect(userInfo.positionRow("200")).toContainText("BTC");
    await expect(userInfo.positionRow("201")).toContainText("ETH");
  });

  test("the positions tab shows a loading skeleton while the read is in flight", async ({
    page,
    world,
  }) => {
    // Seed first, then arm the hold — seed() replaces world.holds, so the hold
    // must be placed AFTER seed to survive the Object.assign inside enterTerminal.
    seed(
      world,
      readyWorld({
        accounts: [
          {
            id: 1n,
            orderMode: "BOOK",
            available: 5_000n * WAD,
            withdrawable: 5_000n * WAD,
            positions: [longPositionFixture()],
          },
        ],
      }),
    );
    armHold(world, "positionsRead");
    const app = new AppPage(page);
    await app.goto();
    await app.signInToTerminal();
    const userInfo = new UserInfoPanel(page);
    // PositionsTable is the default tab — it mounts with the terminal, so the
    // skeleton is already visible while the held read is in-flight.
    await expect(userInfo.positionsLoading).toBeVisible();
    releaseHold(world, "positionsRead");
    await expect(userInfo.positionRow(MARKET.id)).toBeVisible();
  });

  test("the selected user-info tab is marked active", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world);
    await userInfo.selectTab("open-orders");

    await expect(userInfo.tab("open-orders")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(userInfo.tab("positions")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
