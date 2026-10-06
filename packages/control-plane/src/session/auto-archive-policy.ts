import type { SessionStatus } from "@open-inspect/shared/types/sessions";

export const COMPLETED_SESSION_AUTO_ARCHIVE_AGE_MS = 24 * 60 * 60 * 1000;
export const FAILED_SESSION_AUTO_ARCHIVE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_AUTO_ARCHIVE_CRON = "43 * * * *";
/** Leaves room for the candidate query and runtime requests in a Worker invocation. */
export const SESSION_AUTO_ARCHIVE_BATCH_LIMIT = 40;
export const SESSION_AUTO_ARCHIVE_TIMEOUT_MS = 10_000;

export function isOldAutoArchiveSession(
  status: SessionStatus,
  updatedAt: number,
  nowMs: number
): boolean {
  switch (status) {
    case "completed":
      return updatedAt <= nowMs - COMPLETED_SESSION_AUTO_ARCHIVE_AGE_MS;
    case "failed":
    case "cancelled":
      return updatedAt <= nowMs - FAILED_SESSION_AUTO_ARCHIVE_AGE_MS;
    default:
      return false;
  }
}
