import { Margin, Usd } from "@liq/sdk";
import { describe, expect, it } from "vitest";

import { reqMarginText } from "../reqMargin";

describe("reqMarginText", () => {
  it("маржа не прочитана — прочерк, а не $0.00", () => {
    expect(reqMarginText(undefined)).toBe("—");
  });

  it("нулевая известная маржа — $0.00, это не прочерк", () => {
    expect(reqMarginText(Margin(0n))).toBe("$0.00");
  });

  it("известная маржа печатается в долларах", () => {
    expect(reqMarginText(Margin(Usd.parse("3500")))).toBe("$3,500.00");
  });
});
