import { enterTerminal } from "../pages/flows";
import { expect, test } from "../support/fixtures";
import { longPositionFixture, readyWorld } from "../support/world";
import { MARKET, MARKET_ETH, WAD } from "../support/constants";
import { armHold, releaseHold } from "../support/world";

// Зеркало `MARK_DEBOUNCE_MS` из src/features/trade/orderMarginView.ts: e2e не
// импортирует код приложения, поэтому при смене задержки там — менять и здесь.
const MARK_DEBOUNCE_MS = 2_000;

test.describe("trade form gating & controls", () => {
  test("submit is disabled until a size is entered", async ({ page, world }) => {
    const { trade } = await enterTerminal(page, world);
    await expect(trade.submitButton).toBeDisabled();
    await trade.setSize("0.5");
    await expect(trade.submitButton).toBeEnabled();
  });

  test("zero or non-numeric size keeps submit disabled", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    await trade.setSize("0");
    await expect(trade.submitButton).toBeDisabled();
    await trade.setSize("abc");
    await expect(trade.submitButton).toBeDisabled();
    await trade.setSize("0.5");
    await expect(trade.submitButton).toBeEnabled();
  });

  test("no available margin disables submit and shows the hint", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].available = 0n;
      return w;
    });
    await trade.setSize("0.5");
    await expect(trade.insufficientMargin).toBeVisible();
    await expect(trade.submitButton).toBeDisabled();
  });

  test("submit stays disabled while there is no mark price", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () => {
      const w = readyWorld(); // funded BOOK account → margin is fine
      w.price = 0n; // gateway has no mark price yet → markPrice resolves to 0n
      return w;
    });

    await trade.setSize("0.5");
    // it's the missing price gating submit, not the margin…
    await expect(trade.insufficientMargin).toBeHidden();
    await expect(trade.submitButton).toBeDisabled();
  });

  test("tabs reveal the right fields", async ({ page, world }) => {
    const { trade } = await enterTerminal(page, world);

    await expect(trade.limitPriceInput).toBeHidden();

    await trade.selectTab("limit");
    await expect(trade.limitPriceInput).toBeVisible();

    await trade.selectTab("market");
    await expect(trade.limitPriceInput).toBeHidden();
  });

  test("leverage is decoupled from size", async ({ page, world }) => {
    const { trade } = await enterTerminal(page, world);

    // Leverage now drives margin/liq math + the buying-power ceiling only — it
    // must NOT rewrite the typed size (Binance/OKX model).
    await trade.setLeverage(5);
    await expect(trade.leverageValue).toHaveText("5×");
    await expect(trade.sizeInput).toHaveValue("");
  });

  test("Max fills size to full buying power at the current leverage", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.setLeverage(5);
    await trade.clickMax();
    // buying power = available 5,000 * 5x / mark 70,000 ≈ 0.3571, truncated to
    // the 0.001 min-size step → "0.357".
    await expect(trade.sizeInput).toHaveValue(/^0\.357/);
    await expect(trade.sizePctValue).toHaveText("100%");
    await expect(trade.submitButton).toBeEnabled();
  });

  test("ползунок доли шагает четвертями", async ({ page, world }) => {
    const { trade } = await enterTerminal(page, world);

    // Шаг 25 действует на ввод: одна стрелка — одна четверть, а не процент.
    await trade.sizePctThumb.focus();
    await page.keyboard.press("ArrowRight");
    await expect(trade.sizePctValue).toHaveText("25%");
    await page.keyboard.press("End");
    await expect(trade.sizePctValue).toHaveText("100%");
  });

  test("percentage chips set size to a slice of buying power", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    // default leverage 2 → buying power = 5,000 * 2 / 70,000 ≈ 0.142857
    await trade.clickSizePct(50);
    // 50% → ≈ 0.0714 (truncated to 0.001 step → "0.071")
    await expect(trade.sizeInput).toHaveValue(/^0\.071/);
    await expect(trade.sizePctValue).toHaveText("50%");
    await expect(trade.submitButton).toBeEnabled();
  });

  test("the unit toggle converts the size between base and USD", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world); // mark 70,000

    await trade.setSize("0.5");
    await expect(trade.sizeUnitSelect).toHaveText(/BTC/);
    // строка пересчёта считает от МАРКА, а не от цены ордера
    await expect(trade.sizeQuoteValue).toHaveText(/35,000\.00/);
    await trade.setSizeUnit("usd");
    // 0.5 BTC * 70,000 = 35,000 USD
    await expect(trade.sizeInput).toHaveValue("35000");
    await expect(trade.sizeUnitSelect).toHaveText(/USD/);
    // submit still sends the base-size delta (0.5), not the USD figure
    await trade.submit();
    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(0);
    expect(world.submittedOrders.at(-1)?.sizeDelta).toBe(
      (5n * 10n ** 17n).toString(), // 0.5 * 1e18
    );
  });

  test("сводка называет обе стороны: Margin и Liq. Price — из превью контракта", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.setSize("1");
    // Мок превью: начальная маржа 5% от объёма, поддержка — половина её.
    // 1 BTC при марке $70 000: R1 = $3 500 при R0 = 0, то есть шлюз заблокирует
    // $3 500 под любую сторону. Требование поддержки $1 750 против available
    // $5 000 даёт запас $3 250 в обе стороны от марка. Плечо тикета (по
    // умолчанию 2×) в этих числах не участвует — оно только калькулятор размера.
    await expect(trade.orderQty).toContainText("1 BTC");
    await expect(trade.orderValue).toContainText("$70,000.00 USD");
    await expect(trade.orderMargin).toHaveText("$3,500.00 / $3,500.00");
    await expect(trade.orderLiqPrice).toHaveText("66,750 / 73,250");
  });

  test("Margin — разница R1 − R0: у сокращающей стороны $0.00", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      // Лонг 1 BTC: R0 = 5% · $70 000 = $3 500.
      w.accounts[0].positions = [longPositionFixture()];
      w.accounts[0].requiredInitialMargin = 3_500n * WAD;
      return w;
    });

    await trade.setSize("0.5");
    // Лонг наращивает: R1 = 3 500 + 1 750 = 5 250, блокировка 1 750.
    // Шорт сокращает: R1 = 3 500 − 1 750 = 1 750 ≤ R0, блокировка 0n, а не
    // отрицательная и не прочерк.
    await expect(trade.orderMargin).toHaveText("$1,750.00 / $0.00");
  });

  test("превью не прочитано — Margin и Liq. Price прочерки, предупреждения нет", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.faults.orderMarginFails = true;
      return w;
    });

    await trade.setSize("1");
    // Прочерк стоит и до ответа, поэтому сначала дожидаемся, что превью
    // спросили (и мок отказал), и только потом проверяем экран.
    await expect.poll(() => world.orderMarginReads).toBeGreaterThan(0);
    await expect(trade.orderMargin).toHaveText("— / —");
    await expect(trade.orderLiqPrice).toHaveText("— / —");
    await expect(trade.orderWarning).toHaveCount(0);
    await expect(trade.submitButton).toBeEnabled();
  });

  test("лимитка без цены не просит превью и не подаётся; с ценой — считается", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.selectTab("limit");
    await trade.setSize("1");
    await expect(trade.orderMargin).toHaveText("— / —");
    await expect(trade.orderLiqPrice).toHaveText("— / —");
    await expect(trade.submitButton).toBeDisabled();
    expect(world.orderMarginReads).toBe(0);

    // Цена лимитки не равна марку ($70 000): R1 мока считается по цене
    // аргумента чтения, поэтому $3 000 = 1 BTC · $60 000 · 5% бывает только
    // у превью, спрошенного по введённой цене, а не по марку.
    await trade.setLimitPrice("60000");
    await expect(trade.orderMargin).toHaveText("$3,000.00 / $3,000.00");
    await expect(trade.submitButton).toBeEnabled();
  });

  test("сводка стоит на месте и до размера — пустая, а не спрятанная", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    // Сводка — единственное место, где видно, чем два нажатия различаются;
    // появляясь только с размером, она прятала бы это до самого решения.
    await expect(trade.orderSummary).toBeVisible();
    await expect(trade.orderQty).toHaveText(/^0 /);
    await expect(trade.orderMargin).toHaveText("— / —");
    await expect(trade.orderLiqPrice).toHaveText("— / —");
  });

  test("лестница плеча кончается там, где кончает рынок", async ({
    page,
    world,
  }) => {
    // Потолок выводится из начальной маржи рынка: BTC — 400 bps, то есть 25×.
    // Здесь стоял тест на отказ «Min 0.001»: его давал `minSize`, который слал
    // один только мок — у поля нет источника нигде в контуре, и с 0.46.0 нет
    // и самого поля. Тест был зелёным на выдумке фикстуры; на его месте —
    // проверка того, что рынок действительно называет свой потолок.
    const { trade } = await enterTerminal(page, world);

    await trade.leverageSelect.click();
    await expect(page.getByTestId("leverage-option-25")).toBeVisible();
    await expect(page.getByTestId("leverage-option-50")).toHaveCount(0);
  });

  test("сверх free шлюза — предупреждение по R1, а не по блокировке; submit открыт", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      // Цепочка отдаёт available 5 000, шлюз — free 4 500 (locked 500): тест
      // обязан отличить `free` от `available`. R0 = 3 000, ордер на 0.5 BTC даёт
      // R1 = 3 000 + 1 750 = 4 750 — между free и available. Шлюз допускает
      // ордер при free ≥ R1, поэтому отклонит его, а блокировка R1 − R0 = 1 750
      // ≤ free: предупреждение сверяет free именно с R1, и именно с free.
      w.accounts[0].requiredInitialMargin = 3_000n * WAD;
      w.accountMargin = {
        available: (5_000n * WAD).toString(),
        locked: (500n * WAD).toString(),
        free: (4_500n * WAD).toString(),
      };
      return w;
    });
    await trade.setSize("0.5");
    await expect(trade.orderMargin).toHaveText("$1,750.00 / $1,750.00");
    await expect(trade.orderWarning).toHaveText("Exceeds available margin");
    // Предупреждение — не блок: шлюз и цепочка остаются судьёй.
    await expect(trade.submitButton).toBeEnabled();
  });

  test("после смены рынка превью нового рынка не спрашивается по марку старого", async ({
    page,
    world,
  }) => {
    // Часы подменены до загрузки: задержку марка в 2 с прокручиваем руками, а
    // не ждём настенных часов.
    await page.clock.install();
    const { trade, market } = await enterTerminal(page, world, () => {
      const w = readyWorld({ markets: [MARKET, MARKET_ETH] });
      w.priceByMarket[MARKET_ETH.id] = 2_000n * WAD;
      return w;
    });
    const btcMark = 70_000n * WAD;
    const ethMark = 2_000n * WAD;
    const callsFor = (id: string) =>
      world.orderMarginCalls.filter((c) => c.marketId === id);

    await trade.setSize("1");
    await expect.poll(() => callsFor(MARKET.id).at(-1)?.price).toBe(btcMark);
    // Сглаженный марк BTC дошёл до 70 000: теперь он и есть тот, что устаревает
    // при смене рынка.
    await page.clock.runFor(MARK_DEBOUNCE_MS + 500);

    await market.pickMarket(MARKET_ETH.id);
    // Сглаженный марк догоняет через MARK_DEBOUNCE_MS; ждём, пока превью ETH
    // спросят по ETH-му марку, и только потом смотрим на всё, что спрашивали.
    await expect
      .poll(() => callsFor(MARKET_ETH.id).some((c) => c.price === ethMark))
      .toBe(true);
    expect(callsFor(MARKET_ETH.id).length).toBeGreaterThan(0);
    expect(callsFor(MARKET_ETH.id).map((c) => c.price)).not.toContain(btcMark);
  });

  test("смена марка не гасит Margin и Liq. Price в прочерк: цифры удержаны, пока читается новая цена", async ({
    page,
    world,
  }) => {
    await page.clock.install();
    const { trade } = await enterTerminal(page, world);

    await trade.setSize("1");
    // R1 = 5% · 1 BTC · $70 000 = $3 500; ликвидация ±$3 250 от марка.
    await expect(trade.orderMargin).toHaveText("$3,500.00 / $3,500.00");
    await expect(trade.orderLiqPrice).toHaveText("66,750 / 73,250");
    await page.clock.runFor(MARK_DEBOUNCE_MS + 500);

    // Новый марк: превью читается по новой цене и парковано на барьере — это
    // и есть круг RPC, на котором строки раньше становились «—».
    armHold(world, "orderMarginRead");
    world.priceByMarket[MARKET.id] = 71_000n * WAD;
    await page.clock.runFor(5_000 + MARK_DEBOUNCE_MS + 500);

    // Старые цифры на месте и приглушены (пометка есть только пока новое чтение
    // в пути — она же и точка синхронизации); прочерков нет.
    await expect(trade.orderMargin.locator("[data-stale]")).toHaveCount(2);
    await expect(trade.orderMargin).toHaveText("$3,500.00 / $3,500.00");
    await expect(trade.orderLiqPrice).toHaveText("66,750 / 73,250");
    await expect(trade.orderMargin.locator("[data-stale]")).toHaveCount(2);

    releaseHold(world, "orderMarginRead");
    // Мок считает R1 по цене чтения: 5% · $71 000 = $3 550.
    await expect(trade.orderMargin).toHaveText("$3,550.00 / $3,550.00");
    expect(world.orderMarginCalls.map((c) => c.price)).toContain(71_000n * WAD);
    await expect(trade.orderMargin.locator("[data-stale]")).toHaveCount(0);
  });

  test("смена размера при чтении превью — прочерк, а не цифры прошлого размера", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.setSize("1");
    await expect(trade.orderMargin).toHaveText("$3,500.00 / $3,500.00");

    armHold(world, "orderMarginRead");
    await trade.setSize("0.5");
    // Цифры $3 500 — для размера 1, а на экране 0.5: им тут не место.
    await expect(trade.orderMargin).toHaveText("— / —");
    await expect(trade.orderLiqPrice).toHaveText("— / —");

    releaseHold(world, "orderMarginRead");
    await expect(trade.orderMargin).toHaveText("$1,750.00 / $1,750.00");
  });

  test("в пределах free предупреждения нет", async ({ page, world }) => {
    const { trade } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].requiredInitialMargin = 3_000n * WAD;
      return w;
    });
    // R1 = 3 000 + 1 750 = 4 750 ≤ free 5 000. Сначала ждём число — иначе
    // «предупреждения нет» проходило бы и до ответа превью.
    await trade.setSize("0.5");
    await expect(trade.orderMargin).toHaveText("$1,750.00 / $1,750.00");
    await expect(trade.orderWarning).toHaveCount(0);
    await expect(trade.submitButton).toBeEnabled();
  });
});
