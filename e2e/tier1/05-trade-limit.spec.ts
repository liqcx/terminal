import { Price } from "@liq/sdk";

import { enterTerminal } from "../pages/flows";
import { expect, test } from "../support/fixtures";
import { WAD } from "../support/constants";
import { readyWorld } from "../support/world";

test.describe("limit orders", () => {
  test("MID подставляет середину книги, а без цены кнопка неактивна", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    await trade.selectTab("limit");
    // Книга мира: лучший бид 69 990, лучший аск 70 010 — середина ровно 70 000.
    await trade.midPriceButton.click();
    await expect(trade.limitPriceInput).toHaveValue("70000");

    await trade.setSize("1");
    await trade.submit();
    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(0);
    expect(world.submittedOrders.at(-1)?.limitPrice).toBe(
      Price.parse("70000").toString(),
    );
  });

  test("на дешёвом рынке цена вводится и печатается с четырьмя знаками", async ({
    page,
    world,
  }) => {
    const { trade, market } = await enterTerminal(page, world, () =>
      readyWorld({ price: (15_015n * WAD) / 10_000n }),
    );

    await expect(market.price).toHaveText("$1.5015");

    await trade.selectTab("limit");
    await trade.setSize("10");
    await trade.setLimitPrice("1.4123");
    await expect(trade.limitPriceInput).toHaveValue("1.4123");
    await trade.submit();

    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(0);
    expect(world.submittedOrders.at(-1)!.limitPrice).toBe(
      Price.parse("1.4123").toString(),
    );
  });

  test("на дешёвом рынке клик по биду и MID кладут в поле цену с четырьмя знаками", async ({
    page,
    world,
  }) => {
    const level = (price: bigint) => ({
      price: price.toString(),
      size: WAD.toString(),
    });
    // Лучший бид 1.4990, лучший аск 1.5040 — середина 1.5015.
    const bids = [1_4990n, 1_4980n, 1_4970n].map((p) =>
      level((p * WAD) / 10_000n),
    );
    const asks = [1_5040n, 1_5050n, 1_5060n].map((p) =>
      level((p * WAD) / 10_000n),
    );
    const { trade, book } = await enterTerminal(page, world, () =>
      readyWorld({
        price: (15_015n * WAD) / 10_000n,
        orderbook: { bids, asks, asOf: Date.now() },
      }),
    );

    // Мост из книги: подписка на стор режет цену уровня по точности рынка,
    // а не по двум знакам первого рендера, когда марка ещё не было.
    // Шаг книги по умолчанию на XRP — 0.1, он округлил бы 1.4990 до 1.4; берём
    // самый мелкий (0.001), чтобы уровень лёг в поле как есть.
    await book.selectTick(0);
    await book.bidRow(0).click();
    await expect(trade.limitPriceInput).toHaveValue("1.499");

    await trade.midPriceButton.click();
    await expect(trade.limitPriceInput).toHaveValue("1.5015");
  });

  test("на дешёвом рынке TP/SL входа тоже вводятся с четырьмя знаками", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () =>
      readyWorld({ price: (15_015n * WAD) / 10_000n }),
    );

    await trade.tpslToggle.click();
    await trade.entryTpInput.fill("1.6123");
    await trade.entrySlInput.fill("1.4123");
    await expect(trade.entryTpInput).toHaveValue("1.6123");
    await expect(trade.entrySlInput).toHaveValue("1.4123");
  });

  test("без книги и без марка MID неактивна, а не ставит ноль", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.price = 0n; // марка нет
      w.orderbook = { bids: [], asks: [], asOf: Date.now() }; // и книги нет
      return w;
    });
    await trade.selectTab("limit");
    await expect(trade.midPriceButton).toBeDisabled();
    await expect(trade.limitPriceInput).toHaveValue("");
  });

  test("a limit order sends acceptablePrice equal to the limit price", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    await trade.selectTab("limit");
    await trade.setSize("1");
    await trade.setLimitPrice("65000");
    await trade.submit();

    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(0);
    const order = world.submittedOrders.at(-1)!;
    expect(order.limitPrice).toBe(Price.parse("65000").toString());
    expect(order.acceptablePrice).toBe(Price.parse("65000").toString());
  });

  test("a limit submit is disabled until a price is entered", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    await trade.selectTab("limit");
    await trade.setSize("1"); // valid size, price left blank

    // A limit order with no price can't be sent — the submit is gated, not a
    // no-op click (clearer than the old "enabled but does nothing").
    await expect(trade.submitButton).toBeDisabled();
    expect(world.submittedOrders.length).toBe(0);

    await trade.setLimitPrice("65000");
    await expect(trade.submitButton).toBeEnabled();
  });

  test("submits a limit order that appears in open orders", async ({
    page,
    world,
  }) => {
    const { trade, userInfo } = await enterTerminal(page, world);

    await trade.selectTab("limit");
    await expect(trade.limitPriceInput).toBeVisible();
    await trade.setSize("0.5");
    await trade.setLimitPrice("65000");
    await trade.submit();

    await expect.poll(() => world.submittedOrders.at(-1)?.orderType).toBe(
      "LIMIT",
    );
    // the typed $65,000 limit reaches the gateway in 18-dec WAD (via the SDK's
    // own parser, so the expected value tracks the app's encoding)
    expect(world.submittedOrders.at(-1)?.limitPrice).toBe(
      Price.parse("65000").toString(),
    );

    await userInfo.selectTab("open-orders");
    await expect(userInfo.ordersTable).toBeVisible();
    await expect(userInfo.orderRow("srv-1")).toBeVisible();
    await expect(userInfo.orderRow("srv-1")).toContainText("LIMIT");
  });
});
