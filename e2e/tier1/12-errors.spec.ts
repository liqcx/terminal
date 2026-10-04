import { AppPage } from "../pages/AppPage";
import { enterTerminal } from "../pages/flows";
import { UserInfoPanel } from "../pages/TerminalPanels";
import { expect, seed, test } from "../support/fixtures";
import { limitOrderFixture, readyWorld, tradeFixture } from "../support/world";

test.describe("error states", () => {
  test("a gateway 500 on order submit surfaces a trade error", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    world.faults.routeStatus.submitOrder = 500;

    await trade.setSize("0.5");
    await trade.submit();

    await expect(trade.tradeError).toBeVisible();
    // the attempt actually reached the gateway, and the failed submit preserves
    // the user's input (the form only clears on success)
    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(0);
    await expect(trade.sizeInput).toHaveValue("0.5");
  });

  test("a gateway margin rejection is printed in sums, not wei (TRM-42)", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    world.faults.routeStatus.submitOrder = 422;
    world.faults.routeMessage.submitOrder =
      "Insufficient margin: available=38739790679892706434, locked=0, free=38739790679892706434, required=38369917000500000000";

    await trade.setSize("0.5");
    await trade.submit();

    await expect(trade.tradeError).toContainText("Insufficient margin: available");
    await expect(trade.tradeError).not.toHaveText(/\d{12,}/);
  });

  test("a failed order submit can be retried once the fault clears", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    world.faults.routeStatus.submitOrder = 500;

    await trade.setSize("0.5");
    await trade.submit();
    await expect(trade.tradeError).toBeVisible();

    // the input survived the error, so clearing the fault + resubmitting works
    delete world.faults.routeStatus.submitOrder;
    await trade.submit();
    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(1);
    await expect(trade.sizeInput).toHaveValue(""); // success clears the form
  });

  test("a failed cancel leaves the order in place", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({ openOrders: [limitOrderFixture()] }),
    );
    world.faults.routeStatus.cancel = 500;

    await userInfo.selectTab("open-orders");
    await userInfo.cancelOrder("ord-limit-1");

    await expect(userInfo.orderRow("ord-limit-1")).toBeVisible();
    expect(world.cancelledOrderIds).not.toContain("ord-limit-1");
  });

  test("a gateway 500 on a limit submit surfaces a trade error", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    world.faults.routeStatus.submitOrder = 500;

    await trade.selectTab("limit");
    await trade.setSize("1");
    await trade.setLimitPrice("65000");
    await trade.submit();

    await expect(trade.tradeError).toBeVisible();
    await expect(trade.sizeInput).toHaveValue("1"); // not reset on failure
    await expect(trade.limitPriceInput).toHaveValue("65000");
  });

  test("an orders fetch failure leaves the terminal alive and the table empty", async ({
    page,
    world,
  }) => {
    seed(world, readyWorld({ openOrders: [limitOrderFixture()] }));
    world.faults.routeStatus.orders = 500;
    const app = new AppPage(page);
    await app.goto();
    await app.signInToTerminal();
    const userInfo = new UserInfoPanel(page);
    await userInfo.selectTab("open-orders");

    await expect(app.terminal).toBeVisible();
    await expect(userInfo.orderRow("ord-limit-1")).toBeHidden();
    await expect(userInfo.ordersEmpty).toBeVisible();
  });

  test("a trades fetch failure leaves the terminal alive and the table empty", async ({
    page,
    world,
  }) => {
    const { app, userInfo } = await enterTerminal(page, world, () =>
      readyWorld({ trades: [tradeFixture()] }),
    );
    world.faults.routeStatus.trades = 500;
    await userInfo.selectTab("trade-history");

    await expect(app.terminal).toBeVisible();
    await expect(userInfo.tradeRow("fill-1")).toBeHidden();
    await expect(userInfo.historyEmpty).toBeVisible();
  });

  test("the terminal still renders when markets fail to load", async ({
    page,
    world,
  }) => {
    seed(world, readyWorld());
    world.faults.routeStatus.markets = 500;

    const app = new AppPage(page);
    await app.goto();
    await app.signInToTerminal();

    await expect(app.terminal).toBeVisible();
    await expect(page.getByTestId("market-price")).toContainText("—");
    // a causal anchor: markets genuinely failed to load ⇒ the search lists zero
    // rows (the "—" price alone also matches the brief initial-load state).
    await page.getByTestId("market-pill").click();
    await expect(page.locator('[data-testid^="market-row-"]')).toHaveCount(0);
  });
});
