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

/** Больше пяти тостов разом — уже не подсказка, а стена; старые уходят первыми. */
const MAX_TOASTS = 5;

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
        : { toasts: [...s.toasts, toast].slice(-MAX_TOASTS) },
    ),
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Сбросить очередь: конец сессии, тосты прежнего кошелька чужому не нужны. */
export function clearToasts(): void {
  useToastStore.setState({ toasts: [] });
}
