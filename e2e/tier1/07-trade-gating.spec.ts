import { enterTerminal } from "../pages/flows";
import { expect, test } from "../support/fixtures";
import { readyWorld } from "../support/world";

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

  test("сводка называет обе стороны, а ликвидации у них разные", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.setSize("1");
    // Размер 1 BTC при марке $70 000 и плече 2 — стоимость $35 000; поддержка
    // 0,5% рынка мока даёт требование $350, то есть запас $34 650 в обе
    // стороны от марка.
    await expect(trade.orderQty).toContainText("1 BTC");
    await expect(trade.orderValue).toContainText("$70,000.00 USD");
    await expect(trade.orderCost).toContainText("$35,000.00 USD");
    await expect(trade.orderLiqPrice).toHaveText("35,350 / 104,650");
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

  test("a size beyond buying power does not block submit (warning waits for MR-100)", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    // default leverage 2, buying power ≈ 0.1428 BTC; 1 BTC needs ~7x the margin.
    // SDK 0.67.0: `exceeds-available-margin` fires only when both the order's
    // `requiredMargin` (order margin preview) and the gateway `free` are known.
    // The ticket does not read the preview yet (MR-100), so there is no client
    // warning — but the order is still never blocked: the gateway/chain stay
    // the authority. Restore the "Exceeds available margin" assertion when the
    // preview is wired.
    await trade.setSize("1");
    await expect(trade.orderWarning).toHaveCount(0);
    await expect(trade.submitButton).toBeEnabled();
  });
});
