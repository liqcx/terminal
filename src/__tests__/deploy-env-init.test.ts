import { afterEach, describe, expect, it, vi } from "vitest";

// deploy-env-init calls setDeployEnv(VITE_DEPLOY_ENV) on import. Re-import per
// case after resetting modules so the init and getChainConfig share one fresh
// @liq/core module graph (the deploy env lives in @liq/core module state).
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("deploy-env init", () => {
  it("VITE_DEPLOY_ENV=staging → SDK resolves the staging deploy (susdcMarketId 1)", async () => {
    vi.stubEnv("VITE_DEPLOY_ENV", "staging");
    await import("../deploy-env-init");
    const { getChainConfig } = await import("@liq/sdk");
    expect(getChainConfig(6343).susdcMarketId).toBe(1);
    expect(getChainConfig(6343).contracts.PerpsMarketProxy).toBe(
      "0xCf8e93CE16C59A1117c44113492F42b09e7081bc",
    );
    expect(getChainConfig(6343).contracts.PerpsMarketProxy).not.toBe(
      "0xb6318e9453DEBEB7bCed3Ea1AC9aD5a8234236ca",
    );
  });

  it("VITE_DEPLOY_ENV=production → SDK resolves the prod deploy (new contour, PerpsMarketProxy 0xb631…)", async () => {
    vi.stubEnv("VITE_DEPLOY_ENV", "production");
    await import("../deploy-env-init");
    const { getChainConfig } = await import("@liq/sdk");
    const cfg = getChainConfig(6343);
    expect(cfg.susdcMarketId).toBe(1);
    expect(cfg.perpsCoreMarketId).toBe(3);
    // EIP-712 verifyingContract of the 2026-10-09 prod redeploy; the frozen
    // predecessor was 0x330E…
    expect(cfg.contracts.PerpsMarketProxy).toBe(
      "0xb6318e9453DEBEB7bCed3Ea1AC9aD5a8234236ca",
    );
  });

  it("unset VITE_DEPLOY_ENV defaults to staging, not prod", async () => {
    vi.stubEnv("VITE_DEPLOY_ENV", "");
    await import("../deploy-env-init");
    const { getChainConfig } = await import("@liq/sdk");
    expect(getChainConfig(6343).susdcMarketId).toBe(1);
    expect(getChainConfig(6343).contracts.PerpsMarketProxy).toBe(
      "0xCf8e93CE16C59A1117c44113492F42b09e7081bc",
    );
    expect(getChainConfig(6343).contracts.PerpsMarketProxy).not.toBe(
      "0xb6318e9453DEBEB7bCed3Ea1AC9aD5a8234236ca",
    );
  });
});
