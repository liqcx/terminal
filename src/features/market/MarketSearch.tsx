import { compactUsd } from "@liq/core";
import { usePricesQuery } from "@liq/react";
import { Star } from "lucide-react";
import { useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTerminalUiStore } from "@/stores/useTerminalUiStore";

import { DASH, fmtPrice } from "../../lib/format";
import { useDailyChange } from "./useDailyChange";
import { type MarketRow, useMarketRows } from "./useMarketRows";
import { useSelectedMarket } from "./useSelectedMarket";

/** Котируемая валюта контура. Макет подписан USDT — контур торгует в USD. */
const QUOTE = "USD";

const GRID = "grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-center gap-2";

/**
 * Минимальная ширина таблицы рынков.
 *
 * @remarks Шесть колонок не сжимаются в 360 px телефона без потери смысла, а
 * обрезка прятала Change, Volume и звезду совсем (TRM-33). Ниже этой ширины
 * таблица прокручивается вбок целиком — шапка вместе со строками.
 */
const TABLE_MIN_W = "min-w-[600px]";

/**
 * Кружок с буквой вместо логотипа.
 *
 * @remarks Источника иконок токенов в репозитории нет, а карта символов молча
 * промахнётся на первом же новом рынке — тогда рынок останется без опознания.
 */
function Monogram({ symbol }: { symbol: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-bold text-muted">
      {symbol.slice(0, 1)}
    </span>
  );
}

/** Цена одного рынка. Свой хук на строку — звать его в цикле нельзя. */
function LastPrice({ id }: { id: bigint }) {
  const { data } = usePricesQuery([id]);
  const info = data?.[id.toString()];
  return (
    <span className="text-right tabular-nums">
      {info ? `$${fmtPrice(info.price)}` : DASH}
    </span>
  );
}

function ChangeCell({ id, enabled }: { id: bigint; enabled: boolean }) {
  const { change } = useDailyChange(id, { enabled });
  if (!change) return <span className="text-right text-muted">{DASH}</span>;
  return (
    <span
      className={`text-right tabular-nums ${change.pct < 0 ? "text-short" : "text-long"}`}
    >
      {change.pct >= 0 ? "+" : ""}
      {change.pct.toFixed(2)}%
    </span>
  );
}

export function MarketSearch() {
  const { market, setMarketId } = useSelectedMarket();
  const { rows } = useMarketRows();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "favorites">("all");
  const toggleFavorite = useTerminalUiStore((s) => s.toggleFavorite);

  const shown = scope === "all" ? rows : rows.filter((r) => r.favorite);

  function pick(row: MarketRow) {
    setMarketId(row.id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="market-pill"
          className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 hover:bg-surface-2"
        >
          <Monogram symbol={market?.symbol ?? "?"} />
          <span className="text-sm font-bold text-text">
            {market?.symbol ?? DASH}
          </span>
          <span className="text-sm text-muted">{QUOTE}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(680px,calc(100vw-1rem))] p-0"
        data-testid="market-search-popover"
      >
        <Command>
          <div className="flex items-center gap-2 border-b border-border p-2">
            <div className="flex-1">
              <CommandInput
                placeholder="Search"
                data-testid="market-search-input"
              />
            </div>
            <button
              type="button"
              data-testid="market-search-scope-all"
              data-active={scope === "all" ? "true" : "false"}
              onClick={() => setScope("all")}
              className={`rounded px-2 py-1 text-xs ${
                scope === "all" ? "bg-surface-2 text-text" : "text-muted"
              }`}
            >
              All
            </button>
            <button
              type="button"
              data-testid="market-search-scope-favorites"
              data-active={scope === "favorites" ? "true" : "false"}
              onClick={() => setScope("favorites")}
              className={`rounded px-2 py-1 text-xs ${
                scope === "favorites" ? "bg-surface-2 text-text" : "text-muted"
              }`}
            >
              Favorites
            </button>
          </div>
          <div className="overflow-x-auto" data-testid="market-search-scroll">
            <div className={TABLE_MIN_W}>
              <div
                className={`${GRID} border-b border-border px-3 py-1 text-[10px] text-muted`}
              >
                <span>Pair</span>
                <span className="text-right">Last Price</span>
                <span className="text-right">Change</span>
                <span className="text-right">Volume</span>
                <span className="text-right">Market Cap</span>
                <span />
              </div>
              <CommandList>
                <CommandEmpty>No markets.</CommandEmpty>
                <CommandGroup>
                  {shown.map((row) => (
                    <CommandItem
                      key={row.id.toString()}
                      value={row.symbol}
                      data-testid={`market-row-${row.id}`}
                      onSelect={() => pick(row)}
                      className={GRID}
                    >
                      <span className="flex items-center gap-2">
                        <Monogram symbol={row.symbol} />
                        <span className="font-semibold text-text">
                          {row.symbol}
                        </span>
                        <span className="text-muted">{QUOTE}</span>
                        {row.maxLeverage !== null && (
                          <span className="rounded border border-border px-1 text-[10px] text-muted">
                            {row.maxLeverage}x
                          </span>
                        )}
                      </span>
                      <LastPrice id={row.id} />
                      <ChangeCell id={row.id} enabled={open} />
                      <span className="text-right tabular-nums">
                        {row.volumeUsd === null ? DASH : compactUsd(row.volumeUsd)}
                      </span>
                      {/* Рыночной капитализации нет ни в шлюзе, ни в SDK: она
                          требует circulating supply, которого у контура нет.
                          Колонка живёт прочерком, чтобы не расходиться с макетом
                          структурно. */}
                      <span className="text-right text-muted">{DASH}</span>
                      <button
                        type="button"
                        data-testid={`market-favorite-${row.id}`}
                        aria-label="Toggle favorite"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(row.id.toString());
                        }}
                      >
                        <Star
                          size={14}
                          className={row.favorite ? "text-accent" : "text-muted"}
                          fill={row.favorite ? "currentColor" : "none"}
                        />
                      </button>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
