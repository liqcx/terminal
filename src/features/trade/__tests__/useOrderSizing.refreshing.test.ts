// @vitest-environment jsdom
import { LiqProvider, useStaleAfter } from "@liq/react";
import { getViemChain, Price } from "@liq/sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getAddress } from "viem";
import { createConfig, http, WagmiProvider } from "wagmi";
import { connect } from "wagmi/actions";
import { mock } from "wagmi/connectors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MarketSummary } from "../../market/useSelectedMarket";
import { useOrderSizing } from "../useOrderSizing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const chain = getViemChain(6343);
const WALLET = getAddress("0x00000000000000000000000000000000000000a1");
const ACCOUNT = 7n;
const MARKET = {
  id: 200n,
  symbol: "BTC-PERP",
  initialMarginBps: 1000n,
} as unknown as MarketSummary;

/** R1 лонга и шорта разные, чтобы строки сторон различались и в цифрах. */
const R1_LONG = 3_500n * 10n ** 18n;
const R1_SHORT = 4_500n * 10n ** 18n;

type Side = "long" | "short";

let multicalls: number;
let pending: Map<Side, (() => void)[]>;
let hold: Set<Side>;

/** Фейковая цепь: сторона читается по знаку sizeDelta; чтение стороны можно подержать. */
const fakePublicClient = {
  multicall(args: { contracts: { args: readonly unknown[] }[] }) {
    multicalls += 1;
    const side: Side = (args.contracts[0]!.args[2] as bigint) > 0n ? "long" : "short";
    const answer = [
      { status: "success", result: side === "long" ? R1_LONG : R1_SHORT },
      ...Array.from({ length: 5 }, () => ({ status: "failure", error: new Error("n/a") })),
    ];
    if (!hold.has(side)) return Promise.resolve(answer);
    return new Promise((resolve) => {
      const list = pending.get(side) ?? [];
      list.push(() => resolve(answer));
      pending.set(side, list);
    });
  },
};
const fakeOnchain = { config: { chainId: chain.id, publicClient: fakePublicClient } };
const fakeClient = { onUnauthorized: () => () => {}, setToken: () => {} };

let qc: QueryClient;
let root: Root;
const probe = {} as {
  sizing: ReturnType<typeof useOrderSizing>;
  markStale: ReturnType<typeof useStaleAfter>;
};

function Probe() {
  const staleAfter = useStaleAfter();
  const current = useOrderSizing({
    market: MARKET,
    accountId: ACCOUNT,
    available: 10_000n * 10n ** 18n,
    free: 10_000n * 10n ** 18n,
    markPrice: Price.parse("60000"),
    tab: "Market",
    limitPrice: 0n,
  });
  useEffect(() => {
    probe.sizing = current;
    probe.markStale = staleAfter;
  });
  return null;
}

const stale = () => ({ ...probe.sizing.rows.stale });

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function typeSize() {
  await act(async () => {
    probe.sizing.setSizeStr("1");
  });
  await flush();
}

/** Событие счёта: SDK сам протушивает срезы, перечисленные под `orderSettled`. */
async function accountEvent() {
  await act(async () => {
    void probe.markStale("orderSettled", { accountId: ACCOUNT.toString(), wallet: WALLET });
  });
  await flush();
}

async function answer(side: Side) {
  await act(async () => {
    for (const release of pending.get(side) ?? []) release();
    pending.set(side, []);
  });
  await flush();
}

beforeEach(async () => {
  multicalls = 0;
  pending = new Map();
  hold = new Set();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wagmi = createConfig({
    chains: [chain],
    connectors: [mock({ accounts: [WALLET] })],
    transports: { [chain.id]: http() },
  });
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      createElement(
        WagmiProvider,
        { config: wagmi, reconnectOnMount: false },
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(
            LiqProvider,
            { client: fakeClient, onchain: fakeOnchain } as never,
            createElement(Probe),
          ),
        ),
      ),
    );
  });
  await flush();
  await act(async () => {
    await connect(wagmi, { connector: wagmi.connectors[0]! });
  });
  await flush();
});

afterEach(() => act(() => root.unmount()));

describe("useOrderSizing: `refreshing` из useOrderMarginPreview доходит до строк тикета", () => {
  it("до первого ответа — не stale, даже когда срез протух", async () => {
    hold = new Set(["long", "short"]);
    await typeSize();
    expect(multicalls).toBeGreaterThan(0);
    await accountEvent();
    expect(stale()).toEqual({ long: false, short: false });
  });

  it("плановый перезапрос — яркие; событие счёта посреди ответа — обе стороны stale", async () => {
    await typeSize();
    expect(stale()).toEqual({ long: false, short: false });

    hold = new Set(["long", "short"]);
    await act(async () => {
      void qc.refetchQueries({ type: "active" });
    });
    await flush();
    expect(stale()).toEqual({ long: false, short: false });
    hold.clear();
    await answer("long");
    await answer("short");

    hold = new Set(["long", "short"]);
    await accountEvent();
    expect(stale()).toEqual({ long: true, short: true });
    hold.clear();
    await answer("long");
    await answer("short");
    expect(stale()).toEqual({ long: false, short: false });
  });

  it("стороны различимы: ответ лонга пришёл, шорт ещё ждёт — лонг яркий, шорт stale", async () => {
    await typeSize();
    hold = new Set(["long", "short"]);
    await accountEvent();
    expect(stale()).toEqual({ long: true, short: true });
    hold = new Set(["short"]);
    await answer("long");
    expect(stale()).toEqual({ long: false, short: true });
    hold.clear();
    await answer("short");
    expect(stale()).toEqual({ long: false, short: false });
  });
});
