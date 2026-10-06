import * as React from "react";
import { XIcon } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import type { AppToast } from "@/stores/useToastStore";

/** Провайдер тостов: один на приложение, вокруг оболочки экрана. */
export const ToastProvider = ToastPrimitive.Provider;

/** Угол экрана, куда встают тосты. */
export function ToastViewport() {
  return (
    <ToastPrimitive.Viewport
      data-testid="toast-viewport"
      className="fixed right-3 bottom-3 z-50 flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2 outline-none"
    />
  );
}

const TONE: Record<AppToast["tone"], { border: string; title: string }> = {
  error: { border: "border-short/50", title: "text-short" },
  warning: { border: "border-accent/50", title: "text-accent" },
  info: { border: "border-border", title: "text-text" },
};

/**
 * Один тост.
 *
 * @remarks Ошибка висит до закрытия: упавший стоп-лосс — это позиция без
 * защиты, и тост, ушедший сам за 8 секунд, мог её спрятать.
 */
export function ToastCard({
  toast,
  onOpenChange,
  ...props
}: {
  toast: AppToast;
  onOpenChange: (open: boolean) => void;
} & Omit<React.ComponentProps<typeof ToastPrimitive.Root>, "onOpenChange">) {
  const tone = TONE[toast.tone];
  return (
    <ToastPrimitive.Root
      duration={toast.tone === "error" ? Infinity : 8000}
      onOpenChange={onOpenChange}
      className={cn(
        "rounded border bg-surface-2 p-2 text-[11px] shadow-lg",
        tone.border,
      )}
      {...props}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ToastPrimitive.Title className={cn("font-semibold", tone.title)}>
            {toast.title}
          </ToastPrimitive.Title>
          {toast.detail !== undefined && (
            <ToastPrimitive.Description className="text-text">
              {toast.detail}
            </ToastPrimitive.Description>
          )}
          {toast.meta !== undefined && (
            <p className="mt-0.5 text-muted">{toast.meta}</p>
          )}
        </div>
        <ToastPrimitive.Close
          aria-label="Dismiss"
          className="text-muted hover:text-text"
        >
          <XIcon className="size-3" />
        </ToastPrimitive.Close>
      </div>
    </ToastPrimitive.Root>
  );
}
