import { beforeEach, describe, expect, it } from "vitest";

import { useToastStore } from "../useToastStore";

const toast = (id: string) => ({
  id,
  tone: "error" as const,
  title: `t-${id}`,
});

describe("useToastStore", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("показывает тост и убирает закрытый", () => {
    useToastStore.getState().push(toast("a"));
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual(["a"]);
    useToastStore.getState().dismiss("a");
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("тот же id не задваивается, пока тост на экране", () => {
    // Шлюз зеркалит в канал счёта два броадкаста одного исхода.
    useToastStore.getState().push(toast("a"));
    useToastStore.getState().push(toast("a"));
    expect(useToastStore.getState().toasts.length).toBe(1);
  });

  it("держит не больше пяти — старые уходят первыми", () => {
    for (const id of ["1", "2", "3", "4", "5", "6"]) {
      useToastStore.getState().push(toast(id));
    }
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
  });
});
