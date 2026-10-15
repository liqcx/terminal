import type { OracleCandleInterval } from "@liq/core";
import { useCandles } from "@liq/react";
import {
  CandlestickSeries,
  createChart,
  PriceScaleMode,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

import { cssVar } from "@/lib/cssVar";
import { chartPriceFormat } from "@/lib/format";
import type { ChartScaleMode } from "@/stores/useTerminalUiStore";

import { toLwcBar } from "./candleMapping";

/**
 * Чарт всегда читает оракульный ряд.
 *
 * @remarks
 * У торгового маршрута окно ограничено тридцатью сутками независимо от
 * интервала, а на рынке, где час никто не торговал, бара просто нет. Оба
 * свойства ломают именно глубокую историю, ради которой чарт и листается.
 */
export const CHART_ROUTE = "oracle" as const;

/** Сколько последних баров показать на старте; остальное — прокруткой влево. */
const INITIAL_BARS = 120;
/** Пустые бары справа от последнего — воздух под живую свечу. */
const RIGHT_OFFSET_BARS = 4;

export function CandleChart({
  marketId,
  interval,
  bars: barCount,
  scaleMode,
  autoScale,
}: {
  marketId: bigint | undefined;
  interval: OracleCandleInterval;
  /** Глубина истории в барах — потолок маршрута для этого интервала. */
  bars: number;
  scaleMode: ChartScaleMode;
  autoScale: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Какой ряд сейчас залит и сколько в нём баров — чтобы отличить живое
  // обновление хвоста от смены рынка/интервала.
  const loadedRef = useRef<{ key: string; length: number } | null>(null);
  const seriesKey = `${marketId?.toString() ?? ""}:${interval}`;

  const { bars: candles } = useCandles(marketId, interval, {
    bars: barCount,
    route: CHART_ROUTE,
  });
  const bars = useMemo<CandlestickData<UTCTimestamp>[]>(
    () => candles.map(toLwcBar),
    [candles],
  );

  // Mount once: create chart + series. autoSize needs a sized parent.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const muted = cssVar("--muted");
    const border = cssVar("--border");
    const long = cssVar("--long");
    const short = cssVar("--short");
    const chart = createChart(node, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: muted },
      grid: {
        vertLines: { color: border },
        horzLines: { color: border },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: long,
      downColor: short,
      borderVisible: false,
      wickUpColor: long,
      wickDownColor: short,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Push data; LWC requires ascending unique time (the gateway returns sorted).
  //
  // Живое обновление того же ряда — `update` последнего бара, а не `setData`:
  // `setData` сбрасывает прокрутку, и пользователь, ушедший в историю,
  // возвращался бы к правому краю на каждом тике цены. Полная заливка — только
  // на смене рынка/интервала или если ряд пришёл другой длины (переподключение,
  // пропуск баров); тогда окно ставится на последние INITIAL_BARS, дальше —
  // прокрутка.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || bars.length === 0) return;
    const loaded = loadedRef.current;
    const grewByAtMostOne =
      loaded !== null &&
      loaded.key === seriesKey &&
      bars.length >= loaded.length &&
      bars.length - loaded.length <= 1;
    if (grewByAtMostOne) {
      series.update(bars[bars.length - 1]);
    } else {
      series.setData(bars);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, bars.length - INITIAL_BARS),
        to: bars.length - 1 + RIGHT_OFFSET_BARS,
      });
    }
    loadedRef.current = { key: seriesKey, length: bars.length };
  }, [bars, seriesKey]);

  // Точность шкалы — по цене рынка (TRM-32): у серии по умолчанию два знака.
  // Отдельным эффектом и только при смене числа знаков — иначе `applyOptions`
  // шёл бы на каждом тике последнего бара.
  const lastClose = bars.at(-1)?.close;
  const precision =
    lastClose === undefined ? undefined : chartPriceFormat(lastClose).precision;
  const lastCloseRef = useRef(lastClose);
  useEffect(() => {
    lastCloseRef.current = lastClose;
  });
  useEffect(() => {
    const series = seriesRef.current;
    const close = lastCloseRef.current;
    if (!series || close === undefined) return;
    series.applyOptions({ priceFormat: chartPriceFormat(close) });
  }, [precision]);

  // Режим шкалы — отдельным эффектом: он не зависит от данных, а применение
  // его вместе с ними перерисовывало бы шкалу на каждом баре.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale("right").applyOptions({
      mode:
        scaleMode === "percent"
          ? PriceScaleMode.Percentage
          : scaleMode === "log"
            ? PriceScaleMode.Logarithmic
            : PriceScaleMode.Normal,
      autoScale,
    });
  }, [scaleMode, autoScale]);

  return <div ref={containerRef} className="h-full w-full" />;
}
