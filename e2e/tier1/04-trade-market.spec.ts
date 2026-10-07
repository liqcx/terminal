import { Qty } from "@liq/sdk";

import { enterTerminal } from "../pages/flows";
import { expect, test } from "../support/fixtures";
import { GATEWAY_URL, MARKET, WAD } from "../support/constants";
import { orderListsLoaded } from "../support/orderLists";
import {
  conditionalOrderFixture,
  longPositionFixture,
  readyWorld,
} from "../support/world";

test.describe("market orders", () => {
  test("submits a market BUY and resets the form", async ({ page, world }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.selectTab("market");
    await trade.setSize("0.5");
    await expect(trade.submitButton).toBeEnabled();
    await trade.submit();

    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(0);
    const order = world.submittedOrders.at(-1)!;
    expect(order.orderType).toBe("MARKET");
    expect(order.side).toBe("BUY");
    // BUY 0.5 ⇒ +0.5 in 18-dec WAD (pins the sign AND the magnitude/scaling,
    // computed via the SDK's own parser so it can't drift from the app's)
    expect(order.sizeDelta).toBe(Qty.parse("0.5").toString());
    await expect(trade.sizeInput).toHaveValue("");
  });

  test("submits a market SELL (short)", async ({ page, world }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.setSize("0.5");
    await trade.submit("sell");

    await expect.poll(() => world.submittedOrders.at(-1)?.side).toBe("SELL");
    // SELL ⇒ negative signed sizeDelta
    expect(
      String(world.submittedOrders.at(-1)?.sizeDelta).startsWith("-"),
    ).toBe(true);
  });

  test("a market order carries the slippage-guarded acceptablePrice", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.setSize("0.5");
    await trade.submit();
    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(0);
    expect(world.submittedOrders.at(-1)?.acceptablePrice).toBe(
      ((70_000n * WAD * 10_050n) / 10_000n).toString(), // mark + 0.5%
    );

    await trade.setSize("0.5");
    await trade.submit("sell");
    await expect.poll(() => world.submittedOrders.length).toBeGreaterThan(1);
    expect(world.submittedOrders.at(-1)?.acceptablePrice).toBe(
      ((70_000n * WAD * 9_950n) / 10_000n).toString(), // mark − 0.5%
    );
  });

  test("seeds the order nonce from the gateway and recovers from INVALID_NONCE (#443)", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);
    // The client store boots with a timestamp-derived nonce (~1.8e15); the
    // gateway seed is higher, so after the sync lands the FIRST submit must
    // carry exactly the server value — proving the seed, not the local guess.
    // (Soft barrier: this clears when the GET hits the mock, a few microtasks
    // before the .then applies syncNonce — but the fill+click round-trips
    // below dwarf that gap, and a miss fails loudly on the nonce assertion.)
    await expect.poll(() => world.orderNonceRequests).toBeGreaterThan(0);

    await trade.setSize("0.5");
    await trade.submit();
    await expect.poll(() => world.submittedOrders.length).toBe(1);
    expect(String(world.submittedOrders[0].nonce)).toBe("8888888888888888888");
    await expect(trade.sizeInput).toHaveValue(""); // confirmed submit resets

    // Now the gateway rejects the next nonce and names the one it expects:
    // the SDK must resync to it and retry the SAME order — with no surfaced
    // error and no user interaction.
    // ~1.1e17 above the seed — a server-side jump the client can't predict.
    world.faults.submitNonceConflictExpected = "9000000000000000000";
    await trade.setSize("0.25");
    await trade.submit();
    await expect.poll(() => world.submittedOrders.length).toBe(3); // reject + retry
    expect(String(world.submittedOrders[1].nonce)).toBe("8888888888888888889");
    expect(String(world.submittedOrders[2].nonce)).toBe("9000000000000000000");
    await expect(trade.tradeError).toBeHidden(); // recovery, not failure
    await expect(trade.sizeInput).toHaveValue("");
  });

  for (const entry of [
    {
      side: "buy" as const,
      label: "long",
      tp: "80000",
      sl: "60000",
      // Длинную закрывает продажа: TP срабатывает выше рынка, SL ниже.
      closeSide: "SELL",
      tpAbove: true,
      slAbove: false,
    },
    {
      side: "sell" as const,
      label: "short",
      tp: "60000",
      sl: "80000",
      // Короткую закрывает покупка, направления зеркальны.
      closeSide: "BUY",
      tpAbove: false,
      slAbove: true,
    },
  ]) {
    test(`attaches reduce-only TP/SL conditional orders after a ${entry.label} entry`, async ({
      page,
      world,
    }) => {
      const { trade } = await enterTerminal(page, world);

      await trade.setSize("0.5");
      await trade.tpslToggle.click();
      await trade.entryTpInput.fill(entry.tp);
      await trade.entrySlInput.fill(entry.sl);
      await trade.submit(entry.side);

      // entry MARKET + TAKE_PROFIT_MARKET + STOP_MARKET = 3 submits
      await expect.poll(() => world.submittedOrders.length).toBe(3);
      const tp = world.submittedOrders.find(
        (o) => o.orderType === "TAKE_PROFIT_MARKET",
      )!;
      const sl = world.submittedOrders.find(
        (o) => o.orderType === "STOP_MARKET",
      )!;

      // Направление триггера выводится из стороны позиции: перепутанное
      // сработало бы стопом сразу же.
      expect(tp.triggerAbove).toBe(entry.tpAbove);
      expect(sl.triggerAbove).toBe(entry.slAbove);
      expect(tp.side).toBe(entry.closeSide);
      expect(sl.side).toBe(entry.closeSide);
      // Обе ноги закрывают вход ровно: не только знак, но и величина. Нога
      // другого размера оставила бы часть позиции без защиты, а проверка
      // одного знака этого бы не увидела.
      const entryOrder = world.submittedOrders.find(
        (o) => o.orderType === "MARKET",
      )!;
      const closing = (-BigInt(String(entryOrder.sizeDelta))).toString();
      expect(tp.sizeDelta).toBe(closing);
      expect(sl.sizeDelta).toBe(closing);
      // Reduce-only: осиротевший триггер не откроет встречную позицию.
      expect(tp.reduceOnly).toBe(true);
      expect(sl.reduceOnly).toBe(true);
      // Одна связка на обе ноги: без неё сработавший TP не снимет стоп, и тот
      // переживёт позицию. Связку назначает шлюз (SDK `groupId` не шлёт), так
      // что смотрим на ордера, как он их оставил.
      const stored = world.conditionalOrders;
      const storedTp = stored.find(
        (o) => o.orderType === "TAKE_PROFIT_MARKET",
      )!;
      const storedSl = stored.find((o) => o.orderType === "STOP_MARKET")!;
      expect(storedTp.groupId).toBeTruthy();
      expect(storedSl.groupId).toBe(storedTp.groupId);

      // TP/SL prices are cleared after a confirmed submit (no stale re-attach).
      await expect(trade.entryTpInput).toHaveValue("");
      await expect(trade.entrySlInput).toHaveValue("");
    });
  }

  test("a top-up brackets the whole position and replaces the existing legs", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()]; // +1 BTC
      w.conditionalOrders = [
        conditionalOrderFixture({
          id: "tp-old",
          orderType: "TAKE_PROFIT_MARKET",
          triggerPrice: (90_000n * WAD).toString(),
        }),
      ];
      return w;
    });

    await trade.setSize("0.5");
    await trade.tpslToggle.click();
    await trade.entryTpInput.fill("95000");
    await trade.entrySlInput.fill("60000");
    await trade.submit();

    // Вход + обе ноги: скобки ставятся на позицию, а не на один долив.
    await expect.poll(() => world.submittedOrders.length).toBe(3);
    const tp = world.submittedOrders.find(
      (o) => o.orderType === "TAKE_PROFIT_MARKET",
    )!;
    // Закрывать нужно 1.5 BTC — позицию целиком. Нога размером с долив
    // оставила бы исходный BTC без защиты.
    expect(tp.sizeDelta).toBe((-3n * WAD) / 2n + "");
    // Старый тейк переставлен, а не оставлен вторым уровнем: иначе позиция
    // закрылась бы по 90 000, хотя пользователь назвал 95 000.
    await expect.poll(() => world.cancelledOrderIds).toContain("tp-old");
  });

  test("a fired stop (TRIGGERED in the open list, stale TRIGGER_PENDING in the conditional one) is not replaced by the ticket", async ({
    page,
    world,
  }) => {
    // Тот же ордер в двух списках: открытый знает, что стоп сработал, условный
    // ещё держит его живым. Тикет берёт скобки так же, как строка позиции, —
    // из слияния, где побеждает открытый, — и нового стопа не «переставляет».
    const loaded = orderListsLoaded(page);
    const { trade, userInfo } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      w.openOrders = [
        conditionalOrderFixture({ id: "sl-1", status: "TRIGGERED" }),
      ];
      w.conditionalOrders = [conditionalOrderFixture({ id: "sl-1" })];
      return w;
    });
    await loaded;
    // Без позиции `positionBrackets` отдаёт пустые скобки, и тест прошёл бы
    // вхолостую: ждём, пока позиция дойдёт до экрана (тот же запрос, что у тикета).
    await userInfo.selectTab("positions");
    await expect(userInfo.positionRow(MARKET.id)).toBeVisible();

    await trade.setSize("0.5");
    await trade.tpslToggle.click();
    await trade.entrySlInput.fill("60000");
    await trade.submit();

    // Вход + новый стоп; поля очищаются, когда подача кончилась целиком —
    // отмена, если бы она была, уже вышла бы.
    await expect.poll(() => world.submittedOrders.length).toBe(2);
    await expect(trade.entrySlInput).toHaveValue("");
    expect(world.cancelledOrderIds).toEqual([]);
  });

  test("an entry with no position leaves another ticket's legs alone", async ({
    page,
    world,
  }) => {
    // Нет позиции — нет скобок: SELL reduce-only на этом рынке принадлежит
    // чужому тикету, и вход с TP не вправе его переставлять.
    const { trade } = await enterTerminal(page, world, () =>
      readyWorld({
        conditionalOrders: [conditionalOrderFixture({ id: "orphan-1" })],
      }),
    );

    await trade.setSize("0.5");
    await trade.tpslToggle.click();
    await trade.entryTpInput.fill("80000");
    await trade.submit("buy");

    // Вход + новая нога TP; чужая нога не тронута.
    await expect.poll(() => world.submittedOrders.length).toBe(2);
    expect(world.submittedOrders.map((o) => o.orderType)).toEqual([
      "MARKET",
      "TAKE_PROFIT_MARKET",
    ]);
    expect(world.cancelledOrderIds).toEqual([]);
  });

  test("a rejected take-profit leg is named, and the stop is still submitted", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    // Отказ конкретной ноге ставится здесь, а не в `mockGateway`: тот умеет
    // ронять только весь эндпоинт (`faults.routeStatus.submitOrder`). Playwright
    // отдаёт приоритет маршруту, зарегистрированному последним, а
    // `route.fallback()` возвращает моку остальные подачи — вход и стоп.
    // Опросы списка сюда не заходят вовсе: они идут с `?status=…`, а точная
    // строка URL такой запрос не ловит — их по-прежнему обслуживает мок.
    await page.route(`${GATEWAY_URL}/orders`, async (route) => {
      const request = route.request();
      const body =
        request.method() === "POST"
          ? (request.postDataJSON() as { orderType?: string } | null)
          : null;
      if (body?.orderType === "TAKE_PROFIT_MARKET") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "rejected", message: "rejected" },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await trade.setSize("0.5");
    await trade.tpslToggle.click();
    await trade.entryTpInput.fill("80000");
    await trade.entrySlInput.fill("60000");
    await trade.submit();

    // Отказ по одной ноге не отменяет остальные: стоп защищает позицию и
    // подаётся, даже когда TP отвергнут.
    await expect
      .poll(() =>
        world.submittedOrders.filter((o) => o.orderType === "STOP_MARKET"),
      )
      .toHaveLength(1);
    // До 0.54.0 тикет этот отказ терял: вторая подача отцепляла наблюдатель
    // мутации от первой, и `trade-error` молчал.
    await expect(trade.tradeError).toContainText("Take profit");

    // И отказ не переживает следующий вход: с погашенным тумблером скобки не
    // подаются вовсе, поэтому обнулить их ошибку некому, кроме самой подачи.
    // Иначе под принятым ордером висел бы отказ по прошлому.
    await trade.tpslToggle.click();
    await trade.setSize("0.25");
    await trade.submit();
    // Вход + стоп первой подачи (перехваченный TP до мока не доходит) и вход
    // второй — три записи.
    await expect.poll(() => world.submittedOrders.length).toBe(3);
    await expect(trade.tradeError).toBeHidden();
  });

  test("a take-profit on the wrong side of mark blocks that side only", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.setSize("0.5");
    await trade.tpslToggle.click();
    // Марк фикстуры — 70 000. Тейк ниже него у длинной сработал бы на первом
    // тике и закрыл бы её по рынку; короткой такой тейк годится.
    await trade.entryTpInput.fill("60000");

    await expect(trade.submitBuy).toBeDisabled();
    await expect(trade.submitSell).toBeEnabled();
    await expect(trade.entryTpslValidation).toHaveText(
      "TP/SL fit a short only",
    );
  });

  test("switching TP/SL off drops the verdict, even with a bad price still in the fields", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.setSize("0.5");
    await trade.tpslToggle.click();
    // Тот же отказный тейк, что и выше: Buy гаснет, пока тумблер включён.
    await trade.entryTpInput.fill("60000");
    await expect(trade.submitBuy).toBeDisabled();

    // Тумблер гасит поля, а не чистит их — `tp` остаётся «60000» в состоянии.
    // Скобки при этом ставить не собираются, и вердикта для кнопки быть не
    // должно: связывать отказ с полем, которого на экране больше нет, нечем
    // объяснить.
    await trade.tpslToggle.click();
    await expect(trade.submitBuy).toBeEnabled();
  });

  test("brackets that fit neither side block both buttons and name both reasons", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.setSize("0.5");
    await trade.tpslToggle.click();
    // Тейк и стоп на одном уровне ниже марка: длинной не годится тейк,
    // короткой — стоп. Подавать такое нечем, и кнопка об этом говорит.
    await trade.entryTpInput.fill("60000");
    await trade.entrySlInput.fill("60000");

    await expect(trade.submitBuy).toBeDisabled();
    await expect(trade.submitSell).toBeDisabled();
    await expect(trade.entryTpslValidation).toContainText(
      "Long — Take profit: must be above mark",
    );
    await expect(trade.entryTpslValidation).toContainText(
      "Short — Stop loss: must be above mark",
    );
    expect(world.submittedOrders).toHaveLength(0);
  });

  test("a limit entry judges brackets against the entry price too", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world);

    await trade.selectTab("limit");
    await trade.setLimitPrice("65000");
    await trade.setSize("0.5");
    await trade.tpslToggle.click();
    // Ниже марка (70 000), но выше лимита (65 000): цена дойдёт до стопа
    // раньше, чем до входа, — он сгорит до позиции и снимет тейк по связке.
    await trade.entrySlInput.fill("67000");

    await expect(trade.submitBuy).toBeDisabled();
    await expect(trade.entryTpslValidation).toContainText(
      "must be below entry price",
    );
  });

  test("an open position drops the entry-price reference", async ({
    page,
    world,
  }) => {
    const { trade } = await enterTerminal(page, world, () => {
      const w = readyWorld();
      w.accounts[0].positions = [longPositionFixture()];
      return w;
    });

    await trade.selectTab("limit");
    await trade.setLimitPrice("65000");
    await trade.setSize("0.5");
    await trade.tpslToggle.click();
    // Тот же стоп, что запрещён выше: у живой длинной позиции он законен —
    // скобки принадлежат ей, а не ещё не сработавшему лимиту.
    await trade.entrySlInput.fill("67000");

    await expect(trade.submitBuy).toBeEnabled();
    await expect(trade.entryTpslValidation).toBeHidden();
  });
});
