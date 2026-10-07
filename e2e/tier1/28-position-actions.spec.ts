import { Qty } from "@liq/sdk";

import { enterTerminal } from "../pages/flows";
import { MARKET, MARKET_ETH, WAD } from "../support/constants";
import { expect, test } from "../support/fixtures";
import { orderListsLoaded } from "../support/orderLists";
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
      w.conditionalOrders = [conditionalOrderFixture({ id: "sl-1" })];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.closeAll.click();
    await expect(userInfo.closeDialog).toBeVisible();
    // Одна нога на две позиции: единственное число и «these positions».
    await expect(userInfo.closeDialog).toContainText(
      "Reduce-only order of these positions (1) is cancelled once the close settles.",
    );
    await userInfo.closeConfirm.click();

    await expect.poll(() => world.submittedOrders.length).toBe(2);
    const markets = world.submittedOrders.map((o) => o.marketId);
    expect(new Set(markets)).toEqual(new Set([MARKET.id, MARKET_ETH.id]));
    // Короткая закрывается покупкой — сторона берётся от позиции, а не общая.
    const eth = world.submittedOrders.find((o) => o.marketId === MARKET_ETH.id);
    expect(eth?.side).toBe("BUY");
  });

  test("closing submits only the close order — brackets are the backend's to cancel", async ({
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
    // Диалог не приписывает кнопке отмену: reduce-only ордера снимает расчёт,
    // и текст называет это исходом закрытия, с числом ног. Обычная лимитка
    // `rest-1` в счёт не идёт.
    await expect(userInfo.closeDialog).toContainText(
      "Reduce-only orders of this position (2) are cancelled once the close settles.",
    );
    await expect(userInfo.closeDialog).toContainText(
      "Other resting limit orders are not touched.",
    );
    await userInfo.closeConfirm.click();

    await expect.poll(() => world.submittedOrders.length).toBe(1);
    // Диалог закрывается после возврата `close()`: пока он виден, проход ещё
    // идёт, и отмена, поданная ПОСЛЕ закрытия, не проскочила бы мимо проверки.
    await expect(userInfo.closeDialog).toBeHidden();
    // Скобки снимает расчёт, закрывший позицию (Ф2): отмена до подачи
    // оставляла позицию без защиты, если закрытие не исполнялось.
    expect(world.cancelledOrderIds).toEqual([]);
  });

  test("the close dialog counts every reduce-only order: both TP legs and a reduce-only limit (TRM-57)", async ({
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
        conditionalOrderFixture({
          id: "tp-2",
          orderType: "TAKE_PROFIT_MARKET",
          triggerPrice: (95_000n * WAD).toString(),
        }),
      ];
      w.openOrders = [
        limitOrderFixture({ id: "rest-1" }),
        limitOrderFixture({
          id: "ro-1",
          side: "SELL",
          sizeDelta: (-WAD).toString(),
          limitPrice: (99_000n * WAD).toString(),
          reduceOnly: true,
        }),
      ];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.closePosition(MARKET.id).click();
    // Четыре ноги: SL, обе TP и reduce-only лимитка; обычная `rest-1` не в счёте.
    await expect(userInfo.closeDialog).toContainText(
      "Reduce-only orders of this position (4) are cancelled once the close settles.",
    );
  });

  test("a fired bracket (TRIGGERED in the open list, stale TRIGGER_PENDING in the conditional one) is no bracket and no leg", async ({
    page,
    world,
  }) => {
    // Открытый список (опрос 10 с) уже знает, что стоп сработал; условный (60 с)
    // ещё держит ту же заявку живой. Побеждает открытый: у позиции нет ни
    // скобки, ни ноги, и Close не обещает отмену того, чего уже нет.
    const loaded = orderListsLoaded(page);
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      w.openOrders = [
        conditionalOrderFixture({ id: "sl-1", status: "TRIGGERED" }),
      ];
      w.conditionalOrders = [conditionalOrderFixture({ id: "sl-1" })];
      return w;
    });
    await loaded;

    await userInfo.selectTab("positions");
    // Триггер фикстуры — 80 000: живая скобка показала бы его в строке.
    await expect(userInfo.positionRow(MARKET.id)).toBeVisible();
    await expect(userInfo.positionRow(MARKET.id)).not.toContainText("80,000");
    await userInfo.editTpSl(MARKET.id).click();
    await expect(userInfo.tpslSl).toHaveValue("");
    await page.keyboard.press("Escape");

    await userInfo.closePosition(MARKET.id).click();
    await expect(userInfo.closeDialog).toContainText("Closes at market");
    await expect(userInfo.closeDialog).not.toContainText("Reduce-only");
  });

  test("a refused close leaves the brackets in place", async ({
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
      w.faults.routeStatus.submitOrder = 422;
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.closePosition(MARKET.id).click();
    await userInfo.closeConfirm.click();

    // Отказ шлюза остаётся на экране; он же точка стабилизации — к этому
    // моменту проход закрытия кончился, и поздняя отмена уже проявилась бы.
    await expect(page.getByTestId("close-positions-error")).toContainText(
      "could not be closed",
    );
    // Закрытие не исполнилось — позиция без защиты не остаётся.
    expect(world.cancelledOrderIds).toEqual([]);
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
    // Скобка в размер позиции не урезана — строки о размере нет.
    await expect(page.getByTestId("tpsl-size-capped")).toHaveCount(0);

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
    // Сирота — не скобка: размер не урезается позицией другой стороны.
    await expect(
      userInfo.orderRow("orphan-1").getByTestId("order-size-capped"),
    ).toHaveCount(0);
    await userInfo.cancelOrder("orphan-1");
    await expect.poll(() => world.cancelledOrderIds).toEqual(["orphan-1"]);
  });

  test("a bracket bigger than the position shows the size it will close (TRM-21)", async ({
    page,
    world,
  }) => {
    // После частичного закрытия SL подписан на 1.0, позиция — 0.5. Тейк подписан
    // ровно на позицию: он не урезан и маркера не получает.
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture({ positionSize: WAD / 2n })];
      w.conditionalOrders = [
        conditionalOrderFixture({ id: "sl-1" }),
        conditionalOrderFixture({
          id: "tp-1",
          orderType: "TAKE_PROFIT_MARKET",
          sizeDelta: (-WAD / 2n).toString(),
          triggerPrice: (90_000n * WAD).toString(),
        }),
      ];
      return w;
    });

    await userInfo.selectTab("open-orders");
    const capped = userInfo.orderRow("sl-1").getByTestId("order-size-capped");
    await expect(capped).toBeVisible();
    await expect(capped).toContainText("0.5");
    await expect(capped).toContainText("capped to position size");
    // Подпись ячейки называет подписанный размер: он остаётся виден.
    await expect(capped).toHaveAttribute("title", /Signed for 1/);
    await expect(userInfo.orderRow("tp-1")).toBeVisible();
    await expect(
      userInfo.orderRow("tp-1").getByTestId("order-size-capped"),
    ).toHaveCount(0);

    await userInfo.selectTab("positions");
    await userInfo.editTpSl(MARKET.id).click();
    const note = page.getByTestId("tpsl-size-capped-sl");
    await expect(note).toContainText("Stop loss closes 0.5");
    await expect(note).toContainText("capped to position size");
    await expect(note).toContainText("signed for 1");
    // Урезан только стоп: у тейка, подписанного ровно на позицию, строки нет.
    await expect(page.getByTestId("tpsl-size-capped-tp")).toHaveCount(0);
  });

  test("a reduce-only limit bigger than the position shows the size it will close (TRM-48)", async ({
    page,
    world,
  }) => {
    // Лимитка reduce-only на 3 при позиции 1 исполнится на 1; вторая TP-нога
    // подписана на 2 и урезана так же. Контроль: лимитка ровно на позицию — нет.
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      w.openOrders = [
        limitOrderFixture({
          id: "l-1",
          side: "SELL",
          sizeDelta: (-3n * WAD).toString(),
          limitPrice: (99_000n * WAD).toString(),
          reduceOnly: true,
        }),
        limitOrderFixture({
          id: "l-2",
          side: "SELL",
          sizeDelta: (-WAD).toString(),
          limitPrice: (98_000n * WAD).toString(),
          reduceOnly: true,
        }),
      ];
      w.conditionalOrders = [
        conditionalOrderFixture({ id: "sl-1" }),
        conditionalOrderFixture({
          id: "tp-1",
          orderType: "TAKE_PROFIT_MARKET",
          triggerPrice: (90_000n * WAD).toString(),
        }),
        conditionalOrderFixture({
          id: "tp-2",
          orderType: "TAKE_PROFIT_MARKET",
          sizeDelta: (-2n * WAD).toString(),
          triggerPrice: (95_000n * WAD).toString(),
        }),
      ];
      return w;
    });

    await userInfo.selectTab("open-orders");
    const limit = userInfo.orderRow("l-1").getByTestId("order-size-capped");
    await expect(limit).toBeVisible();
    await expect(limit).toContainText("1");
    await expect(limit).toContainText("capped to position size");
    await expect(limit).toHaveAttribute("title", /Signed for 3/);
    // Вторая TP-нога урезана тоже: раньше метку получала только первая.
    const secondTp = userInfo.orderRow("tp-2").getByTestId("order-size-capped");
    await expect(secondTp).toBeVisible();
    await expect(secondTp).toHaveAttribute("title", /Signed for 2/);
    await expect(
      userInfo.orderRow("l-2").getByTestId("order-size-capped"),
    ).toHaveCount(0);
  });

  test("a dialog with both legs capped names each leg and its own signed size (TRM-21)", async ({
    page,
    world,
  }) => {
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture({ positionSize: WAD / 2n })];
      w.conditionalOrders = [
        conditionalOrderFixture({ id: "sl-1" }),
        conditionalOrderFixture({
          id: "tp-1",
          orderType: "TAKE_PROFIT_MARKET",
          sizeDelta: (-3n * WAD).toString(),
          triggerPrice: (90_000n * WAD).toString(),
        }),
      ];
      return w;
    });

    await userInfo.selectTab("positions");
    await userInfo.editTpSl(MARKET.id).click();
    const tp = page.getByTestId("tpsl-size-capped-tp");
    const sl = page.getByTestId("tpsl-size-capped-sl");
    await expect(tp).toContainText("Take profit closes 0.5");
    await expect(tp).toContainText("signed for 3");
    await expect(sl).toContainText("Stop loss closes 0.5");
    await expect(sl).toContainText("signed for 1");
  });

  test("the Size column sorts by the size a bracket will close, not the signed one (TRM-21)", async ({
    page,
    world,
  }) => {
    // SL подписан на 1.0, позиция 0.5 — он закроет 0.5; соседний лимит на 0.7.
    // По подписанному размеру порядок был бы обратным: 1.0 > 0.7.
    const { userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture({ positionSize: WAD / 2n })];
      w.conditionalOrders = [conditionalOrderFixture({ id: "sl-1" })];
      w.openOrders = [
        limitOrderFixture({ id: "lim-1", sizeDelta: ((7n * WAD) / 10n).toString() }),
      ];
      return w;
    });

    await userInfo.selectTab("open-orders");
    await expect(userInfo.orderRow("sl-1")).toBeVisible();
    const rowIds = () =>
      userInfo.ordersTable
        .locator("tbody tr")
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid")));
    // Числовая колонка сортируется сперва по убыванию, вторым щелчком — по
    // возрастанию. По действующему размеру 0.5 (sl-1) < 0.7 (lim-1); по
    // подписанному было бы 1.0 > 0.7, и порядок обоих щелчков обернулся бы.
    await page.getByTestId("table-header-size").click();
    await expect.poll(rowIds).toEqual([
      "orders-table-row-lim-1",
      "orders-table-row-sl-1",
    ]);
    await page.getByTestId("table-header-size").click();
    await expect.poll(rowIds).toEqual([
      "orders-table-row-sl-1",
      "orders-table-row-lim-1",
    ]);
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
