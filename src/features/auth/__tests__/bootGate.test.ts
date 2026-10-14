import { describe, expect, it } from "vitest";

import { bootGateLoading, turnkeyRestoring } from "../bootGate";

describe("turnkeyRestoring", () => {
  it("до создания клиента и во время восстановления сессий — восстанавливается", () => {
    expect(turnkeyRestoring(undefined)).toBe(true);
    expect(turnkeyRestoring("loading")).toBe(true);
  });

  it("ready и error — восстановление закончено", () => {
    expect(turnkeyRestoring("ready")).toBe(false);
    // Сбой конфигурации или клиента не держит лоадер вечно: вход должен быть виден.
    expect(turnkeyRestoring("error")).toBe(false);
  });
});

describe("bootGateLoading", () => {
  it("пока кит восстанавливает сессию — лоадер, даже без личности", () => {
    expect(
      bootGateLoading({ restoring: true, subOrgId: null, embedded: "idle" }),
    ).toBe(true);
  });

  it("сессии нет и кит готов — пропускает к экрану входа", () => {
    expect(
      bootGateLoading({ restoring: false, subOrgId: null, embedded: "idle" }),
    ).toBe(false);
  });

  it("личность есть, кошелёк ещё разрешается — лоадер", () => {
    for (const embedded of ["idle", "resolving"] as const) {
      expect(
        bootGateLoading({ restoring: false, subOrgId: "sub-1", embedded }),
      ).toBe(true);
    }
  });

  it("кошелёк разрешён или разрешение упало — пропускает", () => {
    for (const embedded of ["ready", "failed"] as const) {
      expect(
        bootGateLoading({ restoring: false, subOrgId: "sub-1", embedded }),
      ).toBe(false);
    }
  });
});
