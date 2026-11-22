import { useEffect, useState } from "react";

export const CLOCK_REFRESH_INTERVAL_MS = 60_000;

/**
 * The current time in epoch milliseconds, refreshed every `refreshIntervalMs`.
 * Reading the clock in state keeps render pure while still letting time-based
 * labels (such as token expiry) update on long-lived pages.
 */
export function useNow(refreshIntervalMs: number = CLOCK_REFRESH_INTERVAL_MS): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), refreshIntervalMs);
    return () => clearInterval(id);
  }, [refreshIntervalMs]);
  return now;
}
