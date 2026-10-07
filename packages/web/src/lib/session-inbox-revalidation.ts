import { mutate } from "swr";
import { isSessionInboxKey } from "@/lib/session-inbox-api";

/**
 * Shortest gap between background inbox refetches. Every refetch is a D1
 * query whose cost grows with the number of live sessions, and socket events
 * arrive in bursts (status, child updates, completions, reconnects).
 */
export const SESSION_INBOX_REVALIDATION_INTERVAL_MS = 15_000;

interface InboxRevalidationThrottleOptions {
  revalidate: () => void;
  intervalMs: number;
  now?: () => number;
}

/**
 * Coalesces background inbox revalidation requests. A request is never
 * dropped: it fires immediately when the inbox was last fetched at least
 * `intervalMs` ago, otherwise once when the interval elapses -- unless a
 * fetch that started after the latest request already covered it.
 */
export function createInboxRevalidationThrottle({
  revalidate,
  intervalMs,
  now = Date.now,
}: InboxRevalidationThrottleOptions) {
  let lastFetchStartedAt = Number.NEGATIVE_INFINITY;
  let latestRequestAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    /** Record that an inbox snapshot fetch started, from any trigger. */
    recordFetch() {
      lastFetchStartedAt = now();
    },
    request() {
      latestRequestAt = now();
      if (timer !== null) return;
      const wait = lastFetchStartedAt + intervalMs - latestRequestAt;
      if (wait <= 0) {
        revalidate();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        // A fetch in the same millisecond may have started before the event.
        if (lastFetchStartedAt <= latestRequestAt) revalidate();
      }, wait);
    },
  };
}

const sessionInboxRevalidation = createInboxRevalidationThrottle({
  revalidate: () => void mutate(isSessionInboxKey).catch(() => undefined),
  intervalMs: SESSION_INBOX_REVALIDATION_INTERVAL_MS,
});

export const recordSessionInboxFetch = sessionInboxRevalidation.recordFetch;

/**
 * Refetch the inbox for a background change such as a socket event. User
 * actions that must show their result immediately should call `mutate`.
 */
export const requestSessionInboxRevalidation = sessionInboxRevalidation.request;
