// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { CLOCK_REFRESH_INTERVAL_MS, useNow } from "./use-now";

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("refreshes the clock on each interval and stops after unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result, unmount } = renderHook(() => useNow());
    expect(result.current).toBe(1_000);

    act(() => {
      vi.advanceTimersByTime(CLOCK_REFRESH_INTERVAL_MS);
    });
    expect(result.current).toBe(1_000 + CLOCK_REFRESH_INTERVAL_MS);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
