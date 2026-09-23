import { DecimalInput } from "../../components/ui/DecimalInput";

/**
 * Optional take-profit / stop-loss prices attached to a Market/Limit entry.
 * When enabled, the parent submits reduce-only conditional orders after the
 * entry is accepted (best-effort — not atomic with the entry).
 *
 * @remarks Сам переключатель живёт в `ExecutionFlags` — он один из флагов
 * тикета, и держать его здесь значило бы разложить один ряд флажков по двум
 * местам. Здесь остались поля, которые он открывает.
 */
export function EntryTpSlFields({
  enabled,
  tp,
  setTp,
  sl,
  setSl,
  note,
}: {
  enabled: boolean;
  tp: string;
  setTp: (v: string) => void;
  sl: string;
  setSl: (v: string) => void;
  /** Что сказать под полями: подсказка о стороне или причина отказа. */
  note: { text: string; bad: boolean } | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      {enabled && (
        <div className="flex flex-col gap-2" data-testid="tpsl-fields">
          <div>
            <label className="mb-1 block text-[10px] uppercase text-muted">
              Take profit
            </label>
            <DecimalInput
              value={tp}
              onValueChange={setTp}
              maxDecimals={2}
              placeholder="0.00"
              data-testid="entry-tp-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase text-muted">
              Stop loss
            </label>
            <DecimalInput
              value={sl}
              onValueChange={setSl}
              maxDecimals={2}
              placeholder="0.00"
              data-testid="entry-sl-input"
            />
          </div>
          {note && (
            <p
              className={
                note.bad ? "text-[10px] text-short" : "text-[10px] text-muted"
              }
              data-testid="entry-tpsl-validation"
            >
              {note.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
