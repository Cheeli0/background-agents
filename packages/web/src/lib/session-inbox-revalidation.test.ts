import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInboxRevalidationThrottle } from "./session-inbox-revalidation";

describe("createInboxRevalidationThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const revalidate = vi.fn();
    const throttle = createInboxRevalidationThrottle({ revalidate, intervalMs: 15_000 });
    return { revalidate, throttle };
  }

  it("revalidates immediately when the inbox has never been fetched", () => {
    const { revalidate, throttle } = setup();
    throttle.request();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("revalidates immediately when the last fetch is older than the interval", () => {
    const { revalidate, throttle } = setup();
    throttle.recordFetch();
    vi.advanceTimersByTime(15_000);
    throttle.request();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst after a recent fetch into one trailing revalidation", () => {
    const { revalidate, throttle } = setup();
    throttle.recordFetch();
    vi.advanceTimersByTime(1_000);
    throttle.request();
    throttle.request();
    vi.advanceTimersByTime(5_000);
    throttle.request();
    expect(revalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(8_999);
    expect(revalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("skips the trailing revalidation when a later fetch already covered every request", () => {
    const { revalidate, throttle } = setup();
    throttle.recordFetch();
    throttle.request();
    vi.advanceTimersByTime(2_000);
    // A poll, focus, or user action fetched the inbox after the request.
    throttle.recordFetch();
    vi.advanceTimersByTime(13_000);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("keeps a request that arrived after an intermediate fetch", () => {
    const { revalidate, throttle } = setup();
    throttle.recordFetch();
    throttle.request();
    vi.advanceTimersByTime(2_000);
    throttle.recordFetch();
    vi.advanceTimersByTime(1_000);
    throttle.request();
    vi.advanceTimersByTime(12_000);
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("throttles again after the trailing revalidation fires", () => {
    const { revalidate, throttle } = setup();
    throttle.recordFetch();
    throttle.request();
    vi.advanceTimersByTime(15_000);
    expect(revalidate).toHaveBeenCalledTimes(1);

    // The trailing revalidation's own fetch starts the next window.
    throttle.recordFetch();
    throttle.request();
    expect(revalidate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(revalidate).toHaveBeenCalledTimes(2);
  });
});
