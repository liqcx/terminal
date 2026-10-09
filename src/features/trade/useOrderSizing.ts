import {
  Margin,
  maxLeverageFromBps,
  type OrderVerdict,
  pctToSize,
  Price,
  Qty,
  sizeFromLeverage,
  sizeToPct,
  sizeToUsd,
  Usd,
  usdToSize,
  validateOrder,
} from "@liq/sdk";
import {
  useDebounce,
  useMarginUsage,
  useOrderMarginPreview,
} from "@liq/react";
import { wadToFixed } from "@liq/core";
import { useMemo, useState } from "react";

import type { MarketSummary } from "../market/useSelectedMarket";
import { baseSymbolOf } from "../orderbook/bookView";
import {
  lockAmount,
  MARK_DEBOUNCE_MS,
  type MarketMark,
  previewPrice,
  type RowsView,
  rowsView,
  settledMark,
  warnRequirement,
} from "./orderMarginView";
import { useHeldPreview } from "./useHeldPreview";
import { ticketSummary, type TicketSummary } from "./ticketSummary";

export type SizeUnit = "base" | "usd";

type OrderSizing = {
  sizeStr: string;
  setSizeStr: (v: string) => void;
  unit: SizeUnit;
  setUnit: (u: SizeUnit) => void;
  leverage: number;
  setLeverage: (l: number) => void;
  /** Set size from a 0–100% slice of buying power (slider / chips). */
  setPct: (p: number) => void;
  /** Shortcut for `setPct(100)` — the Max button. */
  setMax: () => void;
  reset: () => void;
  // derived
  sizeQty: bigint; // magnitude, 18-dec base units
  pct: number; // 0–100 slice of buying power (what the control requested)
  maxSize: bigint; // buying-power ceiling, base units
  notional: bigint; // Usd, 18-dec
  /**
   * Обе стороны разом — тикет по макету показывает их рядом.
   *
   * @remarks Знаковый размер живёт здесь, а не отдельным полем: сторона
   * выбирается нажатием кнопки подачи, и до нажатия ни одна из двух не «та самая».
   */
  summary: TicketSummary;
  /**
   * Строки «Margin» и «Liq. Price» по сторонам — числа протокола из превью
   * контракта по цене вкладки; прочерк, пока превью нет.
   */
  rows: RowsView;
  baseSymbol: string;
  baseDecimals: number;
  /** Потолок плеча рынка; `null` — рынок его не объявил. */
  maxLeverage: number | null;
  validation: OrderVerdict;
};

/** Parse the size field (in its active unit) to a magnitude in base units. */
function parseSizeInput(
  sizeStr: string,
  unit: SizeUnit,
  markPrice: bigint,
): bigint {
  if (!sizeStr) return 0n;
  try {
    if (unit === "base") return Qty.parse(sizeStr);
    return markPrice > 0n
      ? usdToSize(Usd.parse(sizeStr), Price(markPrice))
      : 0n;
  } catch {
    return 0n;
  }
}

/**
 * Interlinked order-sizing state for the trade ticket.
 *
 * Two pieces of state: the size string (in the active {@link SizeUnit} — the
 * authoritative order quantity) and `pct` (the slice of buying power the user
 * last requested via the slider/chips/Max — the authoritative slider position).
 * They are reconciled at every setter: typing a size re-derives `pct`; choosing
 * a `pct` rewrites the size; changing leverage rescales the size to preserve
 * `pct` against the new buying-power ceiling. Leverage never *fills* an empty
 * size — it only scales the buying-power ceiling (the ticket's Margin and
 * Liq. Price are the protocol's, from the contract preview).
 */
export function useOrderSizing(params: {
  market: MarketSummary | undefined;
  /** Аккаунт для превью и R0; `undefined` — превью выключено. */
  accountId: bigint | undefined;
  available: bigint;
  /** Шлюзовой `free` (`available − locked`, знаковый); `undefined` — не прочитан. */
  free: bigint | undefined;
  markPrice: bigint;
  /** Активная вкладка тикета. */
  tab: "Market" | "Limit";
  /** Введённая лимитная цена; `0n` — поля нет, и на Limit превью не запрашивается. */
  limitPrice: bigint;
}): OrderSizing {
  const { market, accountId, available, free, markPrice, tab, limitPrice } =
    params;

  const [sizeStr, setSizeStrRaw] = useState("");
  const [unit, setUnitRaw] = useState<SizeUnit>("base");
  const [leverage, setLeverageRaw] = useState(2);
  const [pct, setPctRaw] = useState(0);

  // Потолок плеча выводится из объявленной начальной маржи, а не берётся
  // готовым: `maxLeverage` в `MarketSummary` не существует с 0.46.0 — поле
  // одиннадцать миноров обещало то, чего `/markets` не слал. `null` значит
  // «рынок не объявил», и таким доходит до лестницы и до вердикта.
  const maxLeverage = maxLeverageFromBps(market?.initialMarginBps ?? 0n);
  const baseSymbol = baseSymbolOf(market?.symbol);
  // Минимального шага у рынка нет источника нигде в контуре — ни колонки в
  // схеме, ни ончейн-чтения (0.46.0 убрала и поле). Знаков после запятой
  // выводить не из чего, поэтому их четыре — умолчание поля ввода, а не
  // утверждение о рынке.
  const baseDecimals = 4;

  const sizeQty = parseSizeInput(sizeStr, unit, markPrice);
  const maxSize = sizeFromLeverage({
    availableUsd: Usd(available),
    leverage,
    markPrice: Price(markPrice),
  });
  const summary = ticketSummary({
    sizeQty: Qty(sizeQty),
    markPrice: Price(markPrice),
  });
  const notional = summary.value;

  // Превью контракта по цене вкладки, по запросу на сторону: у тикета две
  // кнопки, и лонг с шортом дают разное R1 и разную ликвидацию. Без рынка
  // `accountId` не передаётся — запрос выключен, а не спрошен про рынок 0.
  // Задерживается пара «рынок + марк», а не один марк: иначе после смены рынка
  // сглаженный марк остался бы старым и превью нового рынка спросилось бы по
  // чужой цене. Пара держится стабильной ссылкой — useDebounce перезапускает
  // таймер по смене значения.
  const currentMark = useMemo<MarketMark>(
    () => ({ marketId: market?.id ?? 0n, mark: markPrice }),
    [market?.id, markPrice],
  );
  const heldMark = useDebounce(currentMark, MARK_DEBOUNCE_MS);
  const debouncedMark = settledMark({ current: currentMark, held: heldMark });
  const priceForPreview = Price(
    previewPrice({ tab, mark: markPrice, debouncedMark, limit: limitPrice }),
  );
  const previewAccount = market === undefined ? undefined : accountId;
  const longPreview = useOrderMarginPreview(
    previewAccount,
    market?.id ?? 0n,
    summary.long.sizeDelta,
    priceForPreview,
  );
  const shortPreview = useOrderMarginPreview(
    previewAccount,
    market?.id ?? 0n,
    summary.short.sizeDelta,
    priceForPreview,
  );
  // R0 — требование аккаунта до ордера. Есть только с данными: загрузка и
  // ошибка дают `undefined`, а не 0n.
  const { data: usage } = useMarginUsage(accountId);
  const r0 = usage?.requiredInitialMargin;
  // R1 — требование всего аккаунта после ордера. `data` есть только у
  // прочитанного превью; ключ запроса несёт размер и цену, поэтому после
  // смены размера, рынка или аккаунта прежнее значение не доживает до новой
  // строки. Одна только цена (марк) двигается без прочерка: цифры стороны
  // удерживаются, пока читается тот же аккаунт, рынок и размер.
  const sideKey = (sizeDelta: bigint) =>
    `${previewAccount ?? ""}:${market?.id ?? ""}:${sizeDelta}`;
  const long = useHeldPreview(
    sideKey(summary.long.sizeDelta),
    {
      r1: longPreview.data?.requiredMargin,
      liq: longPreview.data?.estimatedLiquidationPrice,
    },
    longPreview.isLoading,
  );
  const short = useHeldPreview(
    sideKey(summary.short.sizeDelta),
    {
      r1: shortPreview.data?.requiredMargin,
      liq: shortPreview.data?.estimatedLiquidationPrice,
    },
    shortPreview.isLoading,
  );
  const r1Long = long.r1;
  const r1Short = short.r1;
  const rows = rowsView({
    long: { lock: lockAmount({ r1: r1Long, r0 }), liq: long.liq, stale: long.stale },
    short: {
      lock: lockAmount({ r1: r1Short, r0 }),
      liq: short.liq,
      stale: short.stale,
    },
  });

  const validation = validateOrder({
    markPrice,
    sizeQty: Qty(sizeQty),
    // `0n` — «рынок минимума не объявляет»: единственное, что о нём известно.
    minSize: Qty(0n),
    leverage,
    // Неизвестный потолок не отказывает в ордере: клиент не судья допуску,
    // им остаются шлюз и цепочка. Отказ по выдуманному числу отверг бы
    // ордера, которые протокол принял бы.
    maxLeverage: maxLeverage ?? Number.POSITIVE_INFINITY,
    // Шлюз допускает ордер, если `free ≥ R1` (R1 — требование всего аккаунта
    // после ордера), поэтому с `free` сверяется R1, а не `max(0, R1 − R0)`,
    // которую шлюз блокирует: разница меньше R1 и пропустила бы ордера,
    // которые шлюз откажет. Сторон две, предупреждение одно — судит большее
    // из прочитанных R1, то есть сторона, наращивающая экспозицию. Удержанное
    // R1 тоже годится: предупреждение мягкое и submit не блокирует.
    // `undefined` у любой из величин значит «не знаем»: предупреждения нет.
    requiredMargin: warnRequirement(r1Long, r1Short),
    free: free === undefined ? undefined : Margin(free),
  });

  function fmtForUnit(sizeWad: bigint, u: SizeUnit): string {
    if (sizeWad <= 0n) return "";
    return u === "base"
      ? wadToFixed(sizeWad, baseDecimals)
      : markPrice > 0n
        ? wadToFixed(sizeToUsd(Qty(sizeWad), Price(markPrice)), 2)
        : "";
  }

  // Typed size is authoritative; re-derive the slider position from it.
  function setSizeStr(v: string) {
    setSizeStrRaw(v);
    setPctRaw(sizeToPct(Qty(parseSizeInput(v, unit, markPrice)), maxSize));
  }

  // Chosen percentage is authoritative; rewrite the size to match.
  function setPct(p: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(p)));
    setPctRaw(clamped);
    setSizeStrRaw(fmtForUnit(pctToSize(clamped, maxSize), unit));
  }

  function setLeverage(l: number) {
    setLeverageRaw(l);
    // Preserve the requested slice against the new ceiling — but never fill an
    // empty size (decoupled: bumping leverage with no size leaves it empty).
    if (sizeStr) {
      const nextMax = sizeFromLeverage({
        availableUsd: Usd(available),
        leverage: l,
        markPrice: Price(markPrice),
      });
      setSizeStrRaw(fmtForUnit(pctToSize(pct, nextMax), unit));
    }
  }

  function setUnit(next: SizeUnit) {
    if (next === unit) return;
    // Without a mark price there is no base⇄USD conversion — switching would
    // format to "" and silently drop the typed size. No-op until price loads.
    if (markPrice <= 0n) return;
    setSizeStrRaw(fmtForUnit(sizeQty, next));
    setUnitRaw(next);
  }

  return {
    sizeStr,
    setSizeStr,
    unit,
    setUnit,
    leverage,
    setLeverage,
    setPct,
    setMax: () => setPct(100),
    reset: () => {
      setSizeStrRaw("");
      setPctRaw(0);
    },
    sizeQty,
    pct,
    maxSize,
    notional,
    summary,
    rows,
    baseSymbol,
    baseDecimals,
    maxLeverage,
    validation,
  };
}
