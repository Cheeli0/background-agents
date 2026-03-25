import { describe, expect, it } from "vitest";
import { formatModelOptionDescription, formatRequestMultiplierLabel } from "./format";

describe("formatRequestMultiplierLabel", () => {
  it("formats integer and decimal multipliers", () => {
    expect(formatRequestMultiplierLabel(3)).toBe("Requests x3");
    expect(formatRequestMultiplierLabel(0.33)).toBe("Requests x0.33");
  });

  it("formats zero multipliers", () => {
    expect(formatRequestMultiplierLabel(0)).toBe("Requests x0");
  });
});

describe("formatModelOptionDescription", () => {
  it("appends request multiplier details when available", () => {
    expect(
      formatModelOptionDescription({
        description: "Copilot-backed model",
        requestMultiplier: 3,
      })
    ).toBe("Copilot-backed model · Requests x3");
  });

  it("returns the original description without a multiplier", () => {
    expect(
      formatModelOptionDescription({
        description: "Balanced performance",
        requestMultiplier: undefined,
      })
    ).toBe("Balanced performance");
  });
});
