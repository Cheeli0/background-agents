import { describe, expect, it } from "vitest";
import {
  MAX_REQUEST_MULTIPLIER,
  MIN_REQUEST_MULTIPLIER,
  calculateRequestCount,
  getRequestMultiplier,
  isValidRequestMultiplier,
} from "./models";

describe("getRequestMultiplier", () => {
  it("returns a configured multiplier for models that define one", () => {
    expect(getRequestMultiplier("github-copilot/claude-opus-4-6")).toBe(3);
  });

  it("returns the default multiplier when not configured", () => {
    expect(getRequestMultiplier("openai/gpt-5.4")).toBe(1);
  });
});

describe("calculateRequestCount", () => {
  it("applies the model request multiplier", () => {
    expect(calculateRequestCount(2, "github-copilot/claude-opus-4-6")).toBe(6);
    expect(calculateRequestCount(3, "github-copilot/gpt-4o")).toBe(0);
  });

  it("returns 0 for invalid base counts", () => {
    expect(calculateRequestCount(0, "openai/gpt-5.4")).toBe(0);
    expect(calculateRequestCount(-1, "openai/gpt-5.4")).toBe(0);
    expect(calculateRequestCount(Number.NaN, "openai/gpt-5.4")).toBe(0);
  });
});

describe("isValidRequestMultiplier", () => {
  it("enforces configured multiplier limits", () => {
    expect(isValidRequestMultiplier(MIN_REQUEST_MULTIPLIER)).toBe(true);
    expect(isValidRequestMultiplier(MAX_REQUEST_MULTIPLIER)).toBe(true);
    expect(isValidRequestMultiplier(MIN_REQUEST_MULTIPLIER - 0.01)).toBe(false);
    expect(isValidRequestMultiplier(MAX_REQUEST_MULTIPLIER + 0.01)).toBe(false);
  });
});
