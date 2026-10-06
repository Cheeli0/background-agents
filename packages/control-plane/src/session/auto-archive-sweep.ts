import { z } from "zod";
import type { Logger } from "../logger";
import type { SessionRuntimeClient } from "./runtime-client";
import { SessionInternalPaths } from "./contracts";
import {
  SESSION_AUTO_ARCHIVE_BATCH_LIMIT,
  SESSION_AUTO_ARCHIVE_TIMEOUT_MS,
} from "./auto-archive-policy";

const autoArchiveResponseSchema = z.object({ outcome: z.enum(["archived", "ineligible"]) });

interface AutoArchiveIndex {
  listCandidates(nowMs: number, limit: number): Promise<string[]>;
}

export interface SessionAutoArchiveResult {
  candidates: number;
  archived: number;
  skipped: number;
  errored: number;
  truncated: boolean;
}

/** Hourly bounded retention; the runtime rechecks every candidate before changing state. */
export class SessionAutoArchiveSweep {
  constructor(
    private readonly index: AutoArchiveIndex,
    private readonly sessions: SessionRuntimeClient,
    private readonly log: Logger
  ) {}

  async run(nowMs: number): Promise<SessionAutoArchiveResult> {
    const candidates = await this.index.listCandidates(nowMs, SESSION_AUTO_ARCHIVE_BATCH_LIMIT);
    const result: SessionAutoArchiveResult = {
      candidates: candidates.length,
      archived: 0,
      skipped: 0,
      errored: 0,
      truncated: candidates.length === SESSION_AUTO_ARCHIVE_BATCH_LIMIT,
    };
    const outcomes = await Promise.allSettled(
      candidates.map(async (sessionId) => {
        const response = await this.sessions.fetch(sessionId, SessionInternalPaths.autoArchive, {
          method: "POST",
          signal: AbortSignal.timeout(SESSION_AUTO_ARCHIVE_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Auto-archive failed with status ${response.status}`);
        return autoArchiveResponseSchema.parse(await response.json()).outcome;
      })
    );
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === "rejected") {
        result.errored += 1;
        this.log.warn("Session auto-archive failed", {
          event: "scheduler.session_auto_archive_failed",
          session_id: candidates[index],
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      } else if (outcome.value === "archived") {
        result.archived += 1;
      } else {
        result.skipped += 1;
      }
    }
    this.log.info("Session auto-archive sweep completed", {
      event: "scheduler.session_auto_archive",
      ...result,
    });
    if (result.truncated && result.errored === result.candidates) {
      this.log.error("Session auto-archive sweep made no progress", {
        event: "scheduler.session_auto_archive_stalled",
        candidates: result.candidates,
      });
    }
    return result;
  }
}
