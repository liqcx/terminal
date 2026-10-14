import { enterTerminal } from "../pages/flows";
import { MARKET, MARKET_ETH } from "../support/constants";
import { expect, test } from "../support/fixtures";
import { readyWorld } from "../support/world";

const twoMarkets = () => readyWorld({ markets: [MARKET, MARKET_ETH] });

test.describe("market search", () => {
  test("пилюля открывает поиск со всеми рынками", async ({ page, world }) => {
    const { market } = await enterTerminal(page, world, twoMarkets);

    await market.openSearch();
    await expect(market.searchRows).toHaveCount(2);
    await expect(market.marketRow(MARKET.id)).toContainText("BTC");
    await expect(market.marketRow(MARKET_ETH.id)).toContainText("ETH");
  });

  test("ввод сужает список", async ({ page, world }) => {
    const { market } = await enterTerminal(page, world, twoMarkets);

    await market.openSearch();
    await market.searchInput.fill("ETH");
    await expect(market.marketRow(MARKET_ETH.id)).toBeVisible();
    await expect(market.marketRow(MARKET.id)).toHaveCount(0);
  });

  test("выбор строки меняет рынок экрана", async ({ page, world }) => {
    const { market } = await enterTerminal(page, world, twoMarkets);
    await expect(market.pill).toContainText("BTC");

    await market.pickMarket(MARKET_ETH.id);
    await expect(market.pill).toContainText("ETH");
    // Поиск закрывается тем же выбором — иначе следующий клик попадёт в него.
    await expect(market.search).toHaveCount(0);
  });

  test("звезда избранного переживает перезагрузку", async ({ page, world }) => {
    const { app, market } = await enterTerminal(page, world, twoMarkets);

    await market.openSearch();
    await market.favoriteStar(MARKET_ETH.id).click();
    await page.keyboard.press("Escape");

    await page.reload();
    // Терминал возвращается не мгновенно (JWT из localStorage, переподключение
    // кошелька) — сперва дождаться экрана, иначе поиск некуда открывать.
    await expect(app.terminal).toBeVisible({ timeout: 25_000 });
    await market.openSearch();
    // Область поиска — состояние сессии, не настройка: после перезагрузки она
    // снова "All", и переключить её надо руками.
    await page.getByTestId("market-search-scope-favorites").click();
    await expect(market.searchRows).toHaveCount(1);
    await expect(market.marketRow(MARKET_ETH.id)).toBeVisible();
  });

  test("Market Cap — прочерк, а не выдуманное число", async ({
    page,
    world,
  }) => {
    const { market } = await enterTerminal(page, world, twoMarkets);

    // Ни у шлюза, ни в SDK нет circulating supply — ячейка обязана молчать,
    // а не показывать подставленный ноль.
    await market.openSearch();
    const cells = market.marketRow(MARKET.id).locator("> span");
    await expect(cells.nth(4)).toHaveText("—");
  });

  test("на десктопе список в прежнюю ширину и без прокрутки вбок", async ({
    page,
    world,
  }) => {
    const { market } = await enterTerminal(page, world, twoMarkets);
    await market.openSearch();

    // offsetWidth, не boundingBox: поповер входит с zoom-in-95, и бокс в первые
    // кадры анимации меньше настоящей ширины.
    const width = await market.search.evaluate((el) => el.offsetWidth);
    expect(width).toBe(680);
    const scroll = page.getByTestId("market-search-scroll");
    const overflows = await scroll.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test.describe("мобильная ширина 360px", () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test("список в пределах экрана, звезда и Favorites достижимы", async ({
      page,
      world,
    }) => {
      const { market } = await enterTerminal(page, world, twoMarkets);
      await market.openSearch();

      const box = await market.search.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);
      await expect(
        page.getByTestId("market-search-scope-favorites"),
      ).toBeInViewport();

      // Таблица шире экрана и пользователь может её листать: overflow-x не
      // hidden (программный scrollIntoView работает и там, жест — нет).
      const scroll = page.getByTestId("market-search-scroll");
      const overflowX = await scroll.evaluate((el) => ({
        wider: el.scrollWidth > el.clientWidth,
        style: getComputedStyle(el).overflowX,
      }));
      expect(overflowX).toEqual({ wider: true, style: "auto" });

      // Звезда — последняя колонка: доступна прокруткой таблицы вбок.
      await market.favoriteStar(MARKET_ETH.id).click();
      await page.getByTestId("market-search-scope-favorites").click();
      await expect(market.searchRows).toHaveCount(1);
      await expect(market.marketRow(MARKET_ETH.id)).toBeVisible();
    });
  });
});
