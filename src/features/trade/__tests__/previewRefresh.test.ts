// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useInvalidationRefetch } from "../previewRefresh";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const KEY = ["liq", "account", 1, "0xabc", "orderMarginPreview", "1"] as const;

let next: Promise<number>;
let client: QueryClient;
let root: Root;
let container: HTMLDivElement;

/** То, что делает useOrderSizing: isFetching/data от useQuery + флаг протухания. */
function Probe() {
  const q = useQuery({ queryKey: KEY, queryFn: () => next, staleTime: 5_000 });
  const refreshing = useInvalidationRefetch(
    client,
    KEY,
    q.isFetching,
    q.data !== undefined,
  );
  return createElement(
    "span",
    { id: "out" },
    `${q.isFetching ? "fetching" : "idle"}/${refreshing ? "refreshing" : "plain"}`,
  );
}

const out = () => container.querySelector("#out")?.textContent;

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(async () => {
  next = Promise.resolve(1);
  client = new QueryClient();
  container = document.createElement("div");
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    );
  });
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
});

describe("useInvalidationRefetch", () => {
  it("перечитывание по таймеру (refetch без протухания) — не обновление, цифры яркие", async () => {
    expect(out()).toBe("idle/plain");
    const gate = deferred<number>();
    next = gate.promise;
    await act(async () => {
      void client.refetchQueries({ queryKey: KEY });
    });
    await flush();
    expect(out()).toBe("fetching/plain");
    gate.resolve(2);
    await flush();
    expect(out()).toBe("idle/plain");
  });

  it("invalidateQueries — пока читается, это обновление; кончилось — нет", async () => {
    const gate = deferred<number>();
    next = gate.promise;
    await act(async () => {
      void client.invalidateQueries({ queryKey: KEY });
    });
    await flush();
    expect(out()).toBe("fetching/refreshing");
    gate.resolve(2);
    await flush();
    expect(out()).toBe("idle/plain");
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(false);
  });

  it("событие SDK во время идущего такта — рендер без rerender(): строки тускнеют", async () => {
    const gate = deferred<number>();
    next = gate.promise;
    await act(async () => {
      void client.refetchQueries({ queryKey: KEY });
    });
    await flush();
    expect(out()).toBe("fetching/plain");

    // Такт висит; протухание ставит только флаг: fetchStatus прежний.
    // Ни одного rerender() — только то, что сам хук подписан на кэш.
    act(() => {
      client.getQueryCache().find({ queryKey: KEY })?.invalidate();
    });
    await flush();
    expect(client.getQueryState(KEY)?.fetchStatus).toBe("fetching");
    expect(out()).toBe("fetching/refreshing");
  });

  it("первое чтение без данных, протухшее по событию — не обновление: показывать под пометкой нечего", async () => {
    const fresh = new QueryClient();
    const key = ["fresh"];
    const c2 = document.createElement("div");
    const r2 = createRoot(c2);
    function P2() {
      // Первое чтение, которое не кончается: данных нет.
      const q = useQuery({ queryKey: key, queryFn: () => new Promise<number>(() => {}) });
      return createElement(
        "span",
        null,
        String(useInvalidationRefetch(fresh, key, q.isFetching, q.data !== undefined)),
      );
    }
    await act(async () => {
      r2.render(createElement(QueryClientProvider, { client: fresh }, createElement(P2)));
    });
    await act(async () => {
      void fresh.invalidateQueries({ queryKey: key });
    });
    await flush();
    // Условия «протухло» и «читается» выполнены; без данных флаг всё равно ложен.
    expect(fresh.getQueryState(key)?.isInvalidated).toBe(true);
    expect(fresh.getQueryState(key)?.fetchStatus).toBe("fetching");
    expect(c2.textContent).toBe("false");
    act(() => r2.unmount());
  });
});
