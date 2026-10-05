import { enterTerminal } from "../pages/flows";
import { ToastsPanel } from "../pages/TerminalPanels";
import { MARKET } from "../support/constants";
import { expect, test } from "../support/fixtures";
import {
  conditionalOrderFixture,
  limitOrderFixture,
  readyWorld,
  sseOrderUpdateFrame,
} from "../support/world";

/** Поток счёта `orders:{accountId}`; счёт мока — "1". */
const ACCOUNT_CHANNEL = "orders:1";

test.describe("order outcome toasts", () => {
  test("the terminal listens to the account order stream", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () => readyWorld());
    await expect
      .poll(() => world.sseConnections.flat())
      .toContain(ACCOUNT_CHANNEL);
  });

  test("a failed stop loss shows an error toast and leaves Open Orders", async ({
    page,
    world,
  }) => {
    // TRM-17/TRM-43: тестировщик узнавал о провале только из истории.
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({ conditionalOrders: [conditionalOrderFixture()] }),
    );
    const toasts = new ToastsPanel(page);
    await userInfo.selectTab("open-orders");
    await expect(userInfo.orderRow("ord-cond-1")).toBeVisible();

    world.sseFrames = [
      sseOrderUpdateFrame("ord-cond-1", "FAILED", {
        reason: "no_liquidity",
        channel: ACCOUNT_CHANNEL,
      }),
    ];

    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });
    await expect(toasts.outcome).toContainText("Stop loss failed");
    await expect(toasts.outcome).toContainText("No liquidity to fill it.");
    await expect(toasts.outcome).toContainText(MARKET.symbol);
    // Устаревание из потока счёта: строка не ждёт 60-секундного опроса условных.
    await expect(userInfo.orderRow("ord-cond-1")).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test("the same outcome twice is one toast", async ({ page, world }) => {
    await enterTerminal(page, world, () =>
      readyWorld({ conditionalOrders: [conditionalOrderFixture()] }),
    );
    const toasts = new ToastsPanel(page);
    await expect
      .poll(() => world.sseConnections.flat())
      .toContain(ACCOUNT_CHANNEL);

    world.sseFrames = [
      sseOrderUpdateFrame("ord-cond-1", "FAILED", {
        reason: "no_liquidity",
        channel: ACCOUNT_CHANNEL,
      }),
      sseOrderUpdateFrame("ord-cond-1", "FAILED", {
        channel: ACCOUNT_CHANNEL,
      }),
    ];

    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => world.sseFrames.length).toBe(0);
    await expect(toasts.outcome).toHaveCount(1);
  });

  test("a user's own cancel is silent; a sibling cancel explains itself", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () =>
      readyWorld({
        openOrders: [limitOrderFixture()],
        conditionalOrders: [conditionalOrderFixture()],
      }),
    );
    const toasts = new ToastsPanel(page);
    await expect
      .poll(() => world.sseConnections.flat())
      .toContain(ACCOUNT_CHANNEL);

    // Голый CANCELLED — так приходят Cancel, Save в TP/SL и Close. Оба кадра
    // уходят одним ответом: после каждого ответа SDK переподключается с
    // нарастающей паузой, и второй кадр ждал бы её.
    world.sseFrames = [
      sseOrderUpdateFrame("ord-limit-1", "CANCELLED", {
        channel: ACCOUNT_CHANNEL,
      }),
      sseOrderUpdateFrame("ord-cond-1", "CANCELLED", {
        reason: "sibling_triggered",
        channel: ACCOUNT_CHANNEL,
      }),
    ];
    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => world.sseFrames.length).toBe(0);
    await expect(toasts.outcome).not.toContainText("Limit order");
    await expect(toasts.outcome).toContainText("Stop loss cancelled");
    await expect(toasts.outcome).toContainText(
      "The other leg of the TP/SL pair triggered.",
    );
  });

  test("an order the terminal never saw still gets a toast, without a label", async ({
    page,
    world,
  }) => {
    await enterTerminal(page, world, () => readyWorld());
    const toasts = new ToastsPanel(page);
    await expect
      .poll(() => world.sseConnections.flat())
      .toContain(ACCOUNT_CHANNEL);

    world.sseFrames = [
      sseOrderUpdateFrame("ord-unknown", "FAILED", {
        reason: "brand_new_code",
        channel: ACCOUNT_CHANNEL,
      }),
    ];

    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });
    await expect(toasts.outcome).toContainText("Order failed");
    await expect(toasts.outcome).toContainText("Reason: brand_new_code");
    await expect(toasts.outcome).not.toContainText(MARKET.symbol);
  });

  test("an error toast stays until dismissed", async ({ page, world }) => {
    await enterTerminal(page, world, () => readyWorld());
    const toasts = new ToastsPanel(page);
    await expect
      .poll(() => world.sseConnections.flat())
      .toContain(ACCOUNT_CHANNEL);
    world.sseFrames = [
      sseOrderUpdateFrame("ord-x", "FAILED", { channel: ACCOUNT_CHANNEL }),
    ];
    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });

    await page.waitForTimeout(9_000); // дольше 8 с у не-ошибок
    await expect(toasts.outcome).toHaveCount(1);
    await toasts.outcome.getByRole("button", { name: "Dismiss" }).click();
    await expect(toasts.outcome).toHaveCount(0);
  });

  test("a triggered order is visible in Open Orders and cannot be cancelled", async ({
    page,
    world,
  }) => {
    // TRM-23/TRM-43: до SDK 0.64.0 TRIGGERED не попадал ни в один список.
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({
        openOrders: [
          conditionalOrderFixture({ id: "ord-trig-1", status: "TRIGGERED" }),
        ],
      }),
    );
    await userInfo.selectTab("open-orders");
    await expect(userInfo.orderRow("ord-trig-1")).toBeVisible();
    await expect(userInfo.orderRow("ord-trig-1")).toContainText("TRIGGERED");
    const cancel = page.getByTestId("cancel-order-ord-trig-1");
    await expect(cancel).toBeDisabled();
    await expect(cancel).toHaveAttribute("title", /triggered/);
  });

  test("the same order in both lists shows once, as TRIGGERED", async ({
    page,
    world,
  }) => {
    // Открытый список (опрос 10 с) уже знает TRIGGERED, условный (60 с) ещё
    // держит TRIGGER_PENDING: устаревшая строка с живой отменой не нужна.
    const { userInfo } = await enterTerminal(page, world, () =>
      readyWorld({
        openOrders: [
          conditionalOrderFixture({ id: "ord-dup-1", status: "TRIGGERED" }),
        ],
        conditionalOrders: [conditionalOrderFixture({ id: "ord-dup-1" })],
      }),
    );
    await userInfo.selectTab("open-orders");
    await expect(userInfo.orderRow("ord-dup-1")).toHaveCount(1);
    await expect(userInfo.orderRow("ord-dup-1")).toContainText("TRIGGERED");
    await expect(page.getByTestId("cancel-order-ord-dup-1")).toBeDisabled();
  });

  test("a sticky toast does not outlive the session that raised it", async ({
    page,
    world,
  }) => {
    // SessionGate размонтирует тосты при смене сети; ошибка прежнего кошелька
    // не должна всплыть под следующим.
    const { app } = await enterTerminal(page, world, () => readyWorld());
    const toasts = new ToastsPanel(page);
    await expect
      .poll(() => world.sseConnections.flat())
      .toContain(ACCOUNT_CHANNEL);
    world.sseFrames = [
      sseOrderUpdateFrame("ord-x", "FAILED", { channel: ACCOUNT_CHANNEL }),
    ];
    await expect(toasts.outcome).toHaveCount(1, { timeout: 15_000 });

    const switchTo = (chainId: string) =>
      page.evaluate(
        (id) =>
          (
            window as unknown as {
              ethereum: { request: (a: unknown) => Promise<unknown> };
            }
          ).ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: id }],
          }),
        chainId,
      );
    await switchTo("0x1");
    await expect(app.wrongChainGate).toBeVisible();
    await switchTo("0x" + (6343).toString(16));
    await expect(app.wrongChainGate).toBeHidden();
    await expect(toasts.viewport).toBeAttached();
    await expect(toasts.outcome).toHaveCount(0);
  });
});
