import { Qty } from "@liq/sdk";

import { enterTerminal } from "../pages/flows";
import { MARKET, MARKET_ETH, WAD } from "../support/constants";
import { expect, test } from "../support/fixtures";
import {
  conditionalOrderFixture,
  limitOrderFixture,
  longPositionFixture,
  readyWorld,
} from "../support/world";

/** Марк-цена фикстуры = 70 000; закрытие лонга бьёт вниз на 0,5 %. */
const CLOSE_ACCEPTABLE_SELL = ((70_000n * WAD * 9_950n) / 10_000n).toString();

test.describe("position actions", () => {
  test("closing a row submits a reduce-only market order the other way", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.closePosition(MARKET.id).click();
    await expect(userInfo.closeDialog).toBeVisible();
    await userInfo.closeConfirm.click();

    await expect.poll(() => world.submittedOrders.length).toBe(1);
    const order = world.submittedOrders.at(-1)!;
    expect(order.orderType).toBe("MARKET");
    // Длинную на 1 BTC закрывает продажа на тот же размер, reduce-only —
    // без флага ордер, пришедший после уменьшения позиции, открыл бы шорт.
    expect(order.side).toBe("SELL");
    expect(order.sizeDelta).toBe((-Qty.parse("1")).toString());
    expect(order.reduceOnly).toBe(true);
    expect(order.acceptablePrice).toBe(CLOSE_ACCEPTABLE_SELL);
  });

  test("Close All submits one order per position", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld({ markets: [MARKET, MARKET_ETH] });
      w.accounts[0].positions = [
        longPositionFixture({ marketId: MARKET.id }),
        longPositionFixture({ marketId: MARKET_ETH.id, positionSize: -WAD }),
      ];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.closeAll.click();
    await expect(userInfo.closeDialog).toBeVisible();
    await userInfo.closeConfirm.click();

    await expect.poll(() => world.submittedOrders.length).toBe(2);
    const markets = world.submittedOrders.map((o) => o.marketId);
    expect(new Set(markets)).toEqual(new Set([MARKET.id, MARKET_ETH.id]));
    // Короткая закрывается покупкой — сторона берётся от позиции, а не общая.
    const eth = world.submittedOrders.find((o) => o.marketId === MARKET_ETH.id);
    expect(eth?.side).toBe("BUY");
  });

  test("closing cancels the position's brackets and leaves resting limits alone", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      w.conditionalOrders = [
        conditionalOrderFixture({ id: "sl-1" }),
        conditionalOrderFixture({
          id: "tp-1",
          orderType: "TAKE_PROFIT_MARKET",
          triggerPrice: (90_000n * WAD).toString(),
        }),
      ];
      w.openOrders = [limitOrderFixture({ id: "rest-1" })];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.closePosition(MARKET.id).click();
    await userInfo.closeConfirm.click();

    await expect.poll(() => world.submittedOrders.length).toBe(1);
    // Осиротевший reduce-only триггер исполниться не может, но в списке
    // условных читается как живой — поэтому снимается вместе с позицией.
    expect(new Set(world.cancelledOrderIds)).toEqual(new Set(["sl-1", "tp-1"]));
    // А отдыхающая лимитка не трогается: кнопка про неё не говорила.
    expect(world.cancelledOrderIds).not.toContain("rest-1");
  });

  test("editing TP cancels the old trigger and submits a new one", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      w.conditionalOrders = [
        conditionalOrderFixture({
          id: "tp-1",
          orderType: "TAKE_PROFIT_MARKET",
          triggerPrice: (90_000n * WAD).toString(),
          groupId: "11111111-2222-4333-8444-555555555555",
        }),
      ];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.editTpSl(MARKET.id).click();
    await expect(userInfo.tpslDialog).toBeVisible();
    // Диалог показывает состояние, а не пустой бланк.
    await expect(userInfo.tpslTp).toHaveValue("90000");

    await userInfo.tpslTp.fill("95000");
    await userInfo.tpslSave.click();

    await expect.poll(() => world.submittedOrders.length).toBe(1);
    // Шлюз не умеет менять триггер на месте: правка — отмена и подача. Отмена
    // ждётся, а не читается сразу: она уходит после подачи — замену подают
    // первой, чтобы позиция не осталась без скобки, если подача не пройдёт.
    await expect.poll(() => world.cancelledOrderIds).toContain("tp-1");
    const order = world.submittedOrders.at(-1)!;
    expect(order.orderType).toBe("TAKE_PROFIT_MARKET");
    expect(order.triggerPrice).toBe((95_000n * WAD).toString());
    // Длинная: TP срабатывает выше рынка.
    expect(order.triggerAbove).toBe(true);
    expect(order.reduceOnly).toBe(true);
    // Замена встаёт в связку заменяемой: в новой связке сработавший стоп её
    // не снимет, и переставленный TP переживёт позицию.
    // Связку назначает шлюз, а не клиент: смотрим на ордер, как он стоит.
    const stored = world.conditionalOrders.find((o) => o.id !== "tp-1")!;
    expect(stored.groupId).toBe("11111111-2222-4333-8444-555555555555");
  });

  test("editing one leg of a group-less pair re-submits both into one group", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      // Обе скобки без связки — так выглядит пара, выставленная до 0.54.0.
      w.conditionalOrders = [
        conditionalOrderFixture({
          id: "tp-old",
          orderType: "TAKE_PROFIT_MARKET",
          triggerPrice: (90_000n * WAD).toString(),
        }),
        conditionalOrderFixture({
          id: "sl-old",
          triggerPrice: (60_000n * WAD).toString(),
        }),
      ];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.editTpSl(MARKET.id).click();
    await userInfo.tpslTp.fill("95000");
    await userInfo.tpslSave.click();

    // Тронут один уровень, а подач две: нетронутый стоп переподаётся на своей
    // же цене, чтобы встать в связку к новому тейку. Оставить его как есть
    // значило бы сохранить исходный баг — сработавший тейк его не снял бы.
    await expect.poll(() => world.submittedOrders.length).toBe(2);
    const tp = world.submittedOrders.find(
      (o) => o.orderType === "TAKE_PROFIT_MARKET",
    )!;
    const sl = world.submittedOrders.find(
      (o) => o.orderType === "STOP_MARKET",
    )!;

    expect(tp.triggerPrice).toBe((95_000n * WAD).toString());
    // Цену стопа пользователь не менял — меняется только связка.
    expect(sl.triggerPrice).toBe((60_000n * WAD).toString());
    const storedTp = world.conditionalOrders.find(
      (o) =>
        o.orderType === "TAKE_PROFIT_MARKET" &&
        o.triggerPrice === tp.triggerPrice,
    )!;
    const storedSl = world.conditionalOrders.find(
      (o) =>
        o.orderType === "STOP_MARKET" && o.triggerPrice === sl.triggerPrice,
    )!;
    expect(storedTp.groupId).toBeTruthy();
    expect(storedSl.groupId).toBe(storedTp.groupId);
    // Обе старые заявки снимаются, и только после подач.
    await expect
      .poll(() => [...world.cancelledOrderIds].sort())
      .toEqual(["sl-old", "tp-old"]);
  });

  test("a rejected TP submit is named in the dialog and leaves the old trigger standing", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      w.conditionalOrders = [
        conditionalOrderFixture({
          id: "tp-1",
          orderType: "TAKE_PROFIT_MARKET",
          triggerPrice: (90_000n * WAD).toString(),
        }),
      ];
      w.faults.routeStatus.submitOrder = 422;
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.editTpSl(MARKET.id).click();
    await userInfo.tpslTp.fill("95000");
    await userInfo.tpslSave.click();

    // Отказ называет ногу и остаётся на экране: закрыть диалог поверх ошибки
    // значило бы сообщить об успехе, которого не было.
    await expect(userInfo.tpslError).toContainText("Take profit");
    await expect(userInfo.tpslDialog).toBeVisible();
    // Замену подать не удалось — предшественника не снимают, иначе позиция
    // осталась бы без скобки. Ради этого подача и идёт раньше отмены.
    expect(world.cancelledOrderIds).toEqual([]);
  });

  test("a reduce-only leg of the other side is no bracket: not in the row, not cancelled by Save, cancellable in Open Orders (TRM-9)", async ({
    page,
    world,
  }) => {
    // Сирота закрытой короткой: BUY reduce-only на рынке, где теперь длинная.
    // Раньше хватало рынка, и она читалась как стоп новой позиции.
    const orphanTrigger = (123_456n * WAD).toString();
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      w.conditionalOrders = [
        conditionalOrderFixture({
          id: "orphan-1",
          side: "BUY",
          sizeDelta: WAD.toString(),
          triggerPrice: orphanTrigger,
        }),
      ];
      return w;
    });

    // Колонка TP / SL позиции её цены не показывает.
    await userInfo.selectTab("positions");
    await expect(userInfo.positionRow(MARKET.id)).toBeVisible();
    await expect(userInfo.positionRow(MARKET.id)).not.toContainText("123,456");

    // Редактор открывается пустым, и Save ставит тейк, не трогая сироту.
    await userInfo.editTpSl(MARKET.id).click();
    await expect(userInfo.tpslDialog).toBeVisible();
    await expect(userInfo.tpslTp).toHaveValue("");
    await expect(userInfo.tpslSl).toHaveValue("");
    await userInfo.tpslTp.fill("95000");
    await userInfo.tpslSave.click();
    await expect(userInfo.tpslDialog).toBeHidden();
    expect(world.submittedOrders).toHaveLength(1);
    expect(world.cancelledOrderIds).toEqual([]);

    // Сирота при этом видна в Open Orders, у неё своя кнопка Cancel.
    await userInfo.selectTab("open-orders");
    await expect(userInfo.orderRow("orphan-1")).toBeVisible();
    await expect(userInfo.orderRow("orphan-1")).toContainText("123,456");
    await userInfo.cancelOrder("orphan-1");
    await expect.poll(() => world.cancelledOrderIds).toEqual(["orphan-1"]);
  });

  test("clearing the SL field only cancels", async ({ page, world }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      w.conditionalOrders = [conditionalOrderFixture({ id: "sl-1" })];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.editTpSl(MARKET.id).click();
    await expect(userInfo.tpslSl).toHaveValue("80000");

    await userInfo.tpslSl.fill("");
    await userInfo.tpslSave.click();

    await expect.poll(() => world.cancelledOrderIds).toContain("sl-1");
    // Пустое поле означает «снять», а не «оставить как было»: иначе снять
    // скобку было бы нечем.
    expect(world.submittedOrders).toHaveLength(0);
  });

  test("a take-profit below mark blocks Save and names the reason", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.editTpSl(MARKET.id).click();
    // Марк 70 000: такой тейк у длинной сработал бы сразу и закрыл бы её.
    await userInfo.tpslTp.fill("60000");

    await expect(userInfo.tpslSave).toBeDisabled();
    await expect(userInfo.tpslValidation).toHaveText(
      "Take profit: must be above mark",
    );
    expect(world.submittedOrders).toHaveLength(0);
  });

  test("a bracket on the right side of mark still saves", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.editTpSl(MARKET.id).click();
    // Гейт не должен запирать законную правку: тейк выше марка подаётся.
    await userInfo.tpslTp.fill("95000");

    await expect(userInfo.tpslValidation).toBeHidden();
    await userInfo.tpslSave.click();
    await expect.poll(() => world.submittedOrders.length).toBe(1);
  });
});
