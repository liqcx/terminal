import { create } from "zustand";

/** Тост экрана: слова — от SDK (`describeOrderOutcome`), подпись ордера — от терминала. */
export interface AppToast {
  /** Ключ дедупликации; у исхода ордера — `orderId:status`. */
  id: string;
  tone: "error" | "warning" | "info";
  title: string;
  detail?: string;
  /** Подпись ордера: сторона и рынок. Нет — ордера не было в кешах. */
  meta?: string;
}

interface ToastState {
  toasts: AppToast[];
  push: (toast: AppToast) => void;
  dismiss: (id: string) => void;
}

/**
 * Больше пяти тостов разом — уже не подсказка, а стена; уходят старые, но
 * не ошибки: залипший провал стоп-лосса переживает пять более новых тостов.
 */
const MAX_TOASTS = 5;

/** Оставляет `MAX_TOASTS`: сначала выселяются самые старые не-ошибки, потом старые ошибки. */
function trim(toasts: AppToast[]): AppToast[] {
  let excess = toasts.length - MAX_TOASTS;
  if (excess <= 0) return toasts;
  const drop = new Set<AppToast>();
  for (const t of toasts) {
    if (excess > 0 && t.tone !== "error") {
      drop.add(t);
      excess--;
    }
  }
  for (const t of toasts) {
    if (excess > 0 && !drop.has(t)) {
      drop.add(t);
      excess--;
    }
  }
  return toasts.filter((t) => !drop.has(t));
}

/**
 * Очередь тостов.
 *
 * @remarks Тот же `id`, пока тост на экране, не задваивается: шлюз зеркалит в
 * канал счёта и статус-, и сеттлмент-броадкаст одного исхода. Повтор после
 * закрытия отсекает вызывающий (`useOrderOutcomeToasts` помнит показанные).
 */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (toast) =>
    set((s) =>
      s.toasts.some((t) => t.id === toast.id)
        ? s
        : { toasts: trim([...s.toasts, toast]) },
    ),
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Сбросить очередь: конец сессии, тосты прежнего кошелька чужому не нужны. */
export function clearToasts(): void {
  useToastStore.setState({ toasts: [] });
}
