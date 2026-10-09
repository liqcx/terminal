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
import { useMarketsFullRestQuery } from "@liq/react";
import { wadToFixed } from "@liq/core";
import { useState } from "react";

import type { MarketSummary } from "../market/useSelectedMarket";
import { baseSymbolOf } from "../orderbook/bookView";
import { ticketSummary, type TicketSummary } from "./ticketSummary";

const WAD = 10n ** 18n;
const BPS = 10_000n;

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
  margin: bigint; // margin cost, 18-dec
  /**
   * Обе стороны разом — тикет по макету показывает их рядом.
   *
   * @remarks Знаковый размер и оценка ликвидации живут здесь, а не отдельными
   * полями: сторона выбирается нажатием кнопки подачи, и до нажатия ни одна
   * из двух не «та самая».
   */
  summary: TicketSummary;
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
 * size — it only scales the ceiling and the margin/liq math.
 */
export function useOrderSizing(params: {
  market: MarketSummary | undefined;
  available: bigint;
  /** Шлюзовой `free` (`available − locked`, знаковый); `undefined` — не прочитан. */
  free: bigint | undefined;
  markPrice: bigint;
}): OrderSizing {
  const { market, available, free, markPrice } = params;

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

  // Maintenance-margin fraction (WAD) for the liq-price estimate; best-effort.
  // `maintenanceMarginBps` is absent from leaner market payloads — guard so the
  // estimate stays optional rather than throwing on `undefined`.
  const { data: fullMarkets } = useMarketsFullRestQuery();
  const fullRow = fullMarkets?.find((m) => m.id === market?.id);
  const mmfWad =
    typeof fullRow?.maintenanceMarginBps === "bigint"
      ? (fullRow.maintenanceMarginBps * WAD) / BPS
      : undefined;

  const sizeQty = parseSizeInput(sizeStr, unit, markPrice);
  const maxSize = sizeFromLeverage({
    availableUsd: Usd(available),
    leverage,
    markPrice: Price(markPrice),
  });
  const summary = ticketSummary({
    sizeQty: Qty(sizeQty),
    markPrice: Price(markPrice),
    leverage,
    mmfWad,
  });
  const notional = summary.value;
  const margin = summary.cost;
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
    // Предупреждение `exceeds-available-margin` с 0.67.0 срабатывает, только
    // когда известны обе стороны. `free` — `available − locked` со шлюза.
    // `requiredMargin` — превью шлюза (`useOrderMarginPreview`), в тикете его
    // пока нет: `undefined` значит «не знаем», предупреждения нет. Локальную
    // оценку `margin` сюда не подставляем — она не то, с чем шлюз сверяет free.
    requiredMargin: undefined,
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
    margin,
    summary,
    baseSymbol,
    baseDecimals,
    maxLeverage,
    validation,
  };
}
