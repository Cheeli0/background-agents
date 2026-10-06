import { SessionIndexStore } from "../../src/db/session-index";
import {
  createRequestMetrics,
  instrumentSqlDatabase,
} from "../../src/db/instrumented-sql-database";
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionAutoArchiveStore } from "../../src/db/session-auto-archive-store";
import { SessionAutoArchiveSweep } from "../../src/session/auto-archive-sweep";
import { createSessionRuntimeClientOver } from "../../src/session/runtime-client";
import { createLogger } from "../../src/logger";
import { cleanD1Tables } from "./cleanup";
import { initSession, queryDO, seedActiveUser, seedMessage, waitForSandboxStatus } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("session auto-archive with real D1 and session runtimes", () => {
  beforeEach(async () => {
    await cleanD1Tables();
    await seedActiveUser("reader");
  });
  afterEach(cleanD1Tables);

  async function seedSession(read: boolean, status: "completed" | "cancelled" = "completed") {
    const fixture = await initSession({ userId: "reader" });
    await waitForSandboxStatus(fixture.stub, "failed");
    const oldAt = Date.now() - 8 * DAY_MS;
    const [author] = await queryDO<{ id: string }>(
      fixture.stub,
      "SELECT id FROM participants LIMIT 1"
    );
    if (!author) throw new Error("Missing fixture participant");
    await seedMessage(fixture.stub, {
      id: "result",
      authorId: author.id,
      content: "Finished work",
      source: "web",
      status: "completed",
      createdAt: oldAt,
    });
    await queryDO(fixture.stub, "UPDATE session SET status = ?, updated_at = ?", status, oldAt);
    await env.DB.prepare("UPDATE users SET created_at = 0 WHERE id = 'reader'").run();
    await env.DB.prepare(
      `UPDATE sessions SET status = ?, updated_at = ?, latest_terminal_message_id = 'result',
       latest_terminal_message_created_at = ?, latest_terminal_message_completed_at = ? WHERE id = ?`
    )
      .bind(status, oldAt, oldAt, oldAt, fixture.sessionName)
      .run();
    if (read) {
      await env.DB.prepare(
        "INSERT INTO session_read_states (user_id, session_id, last_read_message_id, updated_at) VALUES ('reader', ?, 'result', ?)"
      )
        .bind(fixture.sessionName, oldAt)
        .run();
    }
    return fixture;
  }

  it("drains read backlog through the runtime and preserves unread sessions", async () => {
    const read = await seedSession(true);
    const unread = await seedSession(false);
    const cancelled = await seedSession(true, "cancelled");
    const sessions = createSessionRuntimeClientOver(
      (id, request) => env.SESSION.get(env.SESSION.idFromName(id)).fetch(request),
      { trace_id: "auto-archive-test", request_id: "auto-archive-test" }
    );
    const store = new SessionAutoArchiveStore(env.DB, "shadow");
    const sweep = new SessionAutoArchiveSweep(store, sessions, createLogger("auto-archive-test"));
    expect(await sweep.run(Date.now())).toMatchObject({ archived: 2, errored: 0 });
    for (const fixture of [read, cancelled]) {
      expect(
        await env.DB.prepare("SELECT status FROM sessions WHERE id = ?")
          .bind(fixture.sessionName)
          .first()
      ).toEqual({ status: "archived" });
      expect(await queryDO(fixture.stub, "SELECT status FROM session")).toEqual([
        { status: "archived" },
      ]);
    }
    expect(
      await env.DB.prepare("SELECT status FROM sessions WHERE id = ?")
        .bind(unread.sessionName)
        .first()
    ).toEqual({ status: "completed" });
    expect(await store.listCandidates(Date.now(), 40)).toEqual([]);
    const restored = await read.stub.fetch("http://internal/internal/unarchive", {
      method: "POST",
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({ status: "completed" });
    expect(await store.isEligible(read.sessionName, Date.now())).toBe(false);
  });

  it("keeps candidate discovery reads bounded for a large completed hierarchy", async () => {
    const oldAt = Date.now() - 2 * DAY_MS;
    const index = new SessionIndexStore(env.DB);
    for (let i = 0; i < 150; i++) {
      await index.create({
        id: i === 0 ? "root" : `child-${i}`,
        parentSessionId: i === 0 ? null : "root",
        ownerTeamId: null,
        visibility: "workspace",
        userId: "reader",
        title: null,
        repoOwner: null,
        repoName: null,
        baseBranch: null,
        model: "anthropic/claude-haiku-4-5",
        reasoningEffort: null,
        status: "completed",
        createdAt: oldAt,
        updatedAt: oldAt,
      });
    }
    await env.DB.prepare("UPDATE users SET created_at = 0 WHERE id = 'reader'").run();
    await env.DB.prepare(
      "UPDATE sessions SET latest_terminal_message_id = id, latest_terminal_message_created_at = created_at, latest_terminal_message_completed_at = created_at"
    ).run();
    await env.DB.prepare(
      "INSERT INTO session_read_states (user_id, session_id, last_read_message_id, updated_at) SELECT 'reader', id, id, updated_at FROM sessions"
    ).run();
    const metrics = createRequestMetrics();
    const store = new SessionAutoArchiveStore(instrumentSqlDatabase(env.DB, metrics), "shadow");
    expect(await store.listCandidates(Date.now(), 40)).toHaveLength(40);
    // A linear pass is cheap; repeated scans of the same hierarchy are not.
    expect(metrics.summarize().sql_rows_read).toBeLessThan(2_000);
  });

  it("rejects a candidate when a new unread result appears before dispatch", async () => {
    const fixture = await seedSession(true);
    const store = new SessionAutoArchiveStore(env.DB, "shadow");
    expect(await store.listCandidates(Date.now(), 40)).toEqual([fixture.sessionName]);
    await env.DB.prepare(
      "UPDATE sessions SET latest_terminal_message_id = 'new-result' WHERE id = ?"
    )
      .bind(fixture.sessionName)
      .run();
    const response = await fixture.stub.fetch("http://internal/internal/auto-archive", {
      method: "POST",
    });
    expect(await response.json()).toEqual({ outcome: "ineligible" });
    expect(await queryDO(fixture.stub, "SELECT status FROM session")).toEqual([
      { status: "completed" },
    ]);
  });
});
