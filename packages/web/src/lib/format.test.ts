import { describe, expect, it } from "vitest";
import {
  formatModelOptionDescription,
  formatPremiumMultiplierLabel,
  formatProviderName,
} from "./format";

describe("formatPremiumMultiplierLabel", () => {
  it("returns null when no multiplier exists", () => {
    expect(formatPremiumMultiplierLabel()).toBeNull();
  });

  it("formats free and paid multipliers", () => {
    expect(formatPremiumMultiplierLabel(0)).toBe("Free");
    expect(formatPremiumMultiplierLabel(3)).toBe("Premium x3");
    expect(formatPremiumMultiplierLabel(0.33)).toBe("Premium x0.33");
  });

  it("ignores invalid multipliers outside safe limits", () => {
    expect(formatPremiumMultiplierLabel(-1)).toBeNull();
    expect(formatPremiumMultiplierLabel(101)).toBeNull();
    expect(formatPremiumMultiplierLabel(Number.NaN)).toBeNull();
    expect(formatPremiumMultiplierLabel(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("formatModelOptionDescription", () => {
  it("prefixes multiplier labels when valid", () => {
    expect(
      formatModelOptionDescription({
        description: "Copilot-backed latest coding model",
        premiumMultiplier: 1,
      })
    ).toBe("Premium x1 | Copilot-backed latest coding model");
  });

  it("falls back to model description for missing or invalid multipliers", () => {
    expect(
      formatModelOptionDescription({
        description: "Fast and efficient",
        premiumMultiplier: undefined,
      })
    ).toBe("Fast and efficient");
    expect(
      formatModelOptionDescription({ description: "Fast and efficient", premiumMultiplier: -5 })
    ).toBe("Fast and efficient");
  });
});

describe("formatProviderName", () => {
  it("formats Z.AI Coding Plan provider names", () => {
    expect(formatProviderName("zai-coding-plan/glm-5")).toBe("Z.AI");
  });

  it("formats Fireworks AI provider names", () => {
    expect(formatProviderName("fireworks-ai/kimi-k2p5-turbo")).toBe("Fireworks AI");
  });
});
