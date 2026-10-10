import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { isInvalidationRefetch } from "../previewRefresh";

const KEY = ["liq", "account", 1, "0xabc", "orderMarginPreview", "1"] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Живой запрос с данными и подписчиком: ровно то, что держит хук превью. */
async function readyQuery() {
  const client = new QueryClient();
  let next: Promise<number> = Promise.resolve(1);
  const observer = new QueryObserver(client, {
    queryKey: KEY,
    queryFn: () => next,
    staleTime: 5_000,
  });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  const read = () => ({
    isFetching: client.isFetching({ queryKey: KEY }) > 0,
    hasData: client.getQueryData(KEY) !== undefined,
  });
  return {
    client,
    observer,
    read,
    setNext: (p: Promise<number>) => (next = p),
    unsubscribe,
  };
}

let stop: (() => void) | undefined;
afterEach(() => stop?.());

describe("isInvalidationRefetch", () => {
  it("перечитывание по таймеру (refetch без протухания) — не обновление, цифры яркие", async () => {
    const q = await readyQuery();
    stop = q.unsubscribe;
    const gate = deferred<number>();
    q.setNext(gate.promise);

    const pending = q.observer.refetch();
    const { isFetching, hasData } = q.read();
    expect(isFetching).toBe(true);
    expect(hasData).toBe(true);
    expect(isInvalidationRefetch(q.client, KEY, isFetching, hasData)).toBe(false);

    gate.resolve(2);
    await pending;
  });

  it("invalidateQueries по ключу — пока читается, это обновление; кончилось — нет", async () => {
    const q = await readyQuery();
    stop = q.unsubscribe;
    const gate = deferred<number>();
    q.setNext(gate.promise);

    const invalidated = q.client.invalidateQueries({ queryKey: KEY });
    const mid = q.read();
    expect(mid.isFetching).toBe(true);
    expect(isInvalidationRefetch(q.client, KEY, mid.isFetching, mid.hasData)).toBe(
      true,
    );

    gate.resolve(2);
    await invalidated;
    const done = q.read();
    expect(done.isFetching).toBe(false);
    expect(isInvalidationRefetch(q.client, KEY, done.isFetching, done.hasData)).toBe(
      false,
    );
    // Флаг протухания сброшен успехом: следующий такт таймера снова яркий.
    expect(q.client.getQueryState(KEY)?.isInvalidated).toBe(false);
  });

  it("чтение без данных — не обновление: показывать под пометкой нечего", () => {
    const client = new QueryClient();
    expect(isInvalidationRefetch(client, KEY, true, false)).toBe(false);
  });

  it("нет запроса по ключу — не обновление", () => {
    const client = new QueryClient();
    expect(isInvalidationRefetch(client, KEY, true, true)).toBe(false);
  });
});
