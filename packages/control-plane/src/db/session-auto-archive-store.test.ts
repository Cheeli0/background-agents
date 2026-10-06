import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeSqlDatabase, type NodeSqlDatabase } from "../node/sqlite-database";
import { SessionAutoArchiveStore } from "./session-auto-archive-store";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = 20 * DAY_MS;

describe("SessionAutoArchiveStore", () => {
  let db: NodeSqlDatabase;
  let store: SessionAutoArchiveStore;
  beforeEach(async () => {
    db = createNodeSqlDatabase(new DatabaseSync(":memory:"));
    for (const sql of [
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, status TEXT, updated_at INTEGER,
       root_session_id TEXT, user_id TEXT, owner_team_id TEXT, visibility TEXT,
       latest_terminal_message_id TEXT, latest_terminal_message_completed_at INTEGER)`,
      `CREATE TABLE users (id TEXT PRIMARY KEY, created_at INTEGER)`,
      `CREATE TABLE session_read_states (user_id TEXT, session_id TEXT, last_read_message_id TEXT)`,
      `CREATE TABLE session_collaborators (session_id TEXT, user_id TEXT)`,
      `CREATE TABLE team_memberships (team_id TEXT, user_id TEXT)`,
      `CREATE TABLE roles (id TEXT, key TEXT)`,
      `CREATE TABLE user_role_assignments (user_id TEXT, role_id TEXT)`,
    ])
      await db.prepare(sql).run();
    await db.prepare("INSERT INTO users VALUES ('reader', 0)").run();
    store = new SessionAutoArchiveStore(db, "on");
  });
  afterEach(() => db.close());

  async function session(id: string, status = "completed", ageMs = 2 * DAY_MS, root = id) {
    await db
      .prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, 'reader', NULL, 'workspace', ?, ?)`)
      .bind(id, status, NOW_MS - ageMs, root, `${id}-result`, NOW_MS - ageMs)
      .run();
  }
  async function read(id: string, user = "reader", message = `${id}-result`) {
    await db
      .prepare("INSERT INTO session_read_states VALUES (?, ?, ?)")
      .bind(user, id, message)
      .run();
  }

  it("archives only read sessions past their status-specific age", async () => {
    await session("completed");
    await read("completed");
    await session("recent", "completed", DAY_MS - 1);
    await read("recent");
    await session("failed", "failed", 7 * DAY_MS);
    await read("failed");
    await session("cancelled", "cancelled", 7 * DAY_MS);
    await read("cancelled");
    await session("failure-recent", "failed", 7 * DAY_MS - 1);
    await read("failure-recent");
    await session("active", "active", 10 * DAY_MS);
    await read("active");
    expect((await store.listCandidates(NOW_MS, 50)).sort()).toEqual([
      "cancelled",
      "completed",
      "failed",
    ]);
  });

  it("keeps unread results, including a new result after an earlier acknowledgement", async () => {
    await session("unread");
    await session("new-result");
    await read("new-result", "reader", "previous-result");
    expect(await store.listCandidates(NOW_MS, 50)).toEqual([]);
    await read("unread");
    expect(await store.isEligible("unread", NOW_MS)).toBe(true);
  });

  it("keeps every member of a hierarchy with unread or live work", async () => {
    await session("root");
    await read("root");
    await session("child", "completed", 2 * DAY_MS, "root");
    expect(await store.listCandidates(NOW_MS, 50)).toEqual([]);
    await read("child");
    expect((await store.listCandidates(NOW_MS, 50)).sort()).toEqual(["child", "root"]);
    await db.prepare("UPDATE sessions SET status = 'active' WHERE id = 'child'").run();
    expect(await store.isEligible("root", NOW_MS)).toBe(false);
  });

  it("protects unread results for other readers but not inaccessible private sessions", async () => {
    await session("shared");
    await read("shared");
    await db.prepare("INSERT INTO users VALUES ('other', 0)").run();
    expect(await store.isEligible("shared", NOW_MS)).toBe(false);
    await db.prepare("UPDATE sessions SET visibility = 'private' WHERE id = 'shared'").run();
    expect(await store.isEligible("shared", NOW_MS)).toBe(true);
    await db.prepare("INSERT INTO session_collaborators VALUES ('shared', 'other')").run();
    expect(await store.isEligible("shared", NOW_MS)).toBe(false);
  });

  it("protects unread team members and administrators according to rollout visibility", async () => {
    await session("team");
    await read("team");
    await db.prepare("INSERT INTO users VALUES ('other', 0)").run();
    await db
      .prepare(
        "UPDATE sessions SET visibility = 'team', owner_team_id = 'team-1' WHERE id = 'team'"
      )
      .run();
    expect(await store.isEligible("team", NOW_MS)).toBe(true);
    await db.prepare("INSERT INTO team_memberships VALUES ('team-1', 'other')").run();
    expect(await store.isEligible("team", NOW_MS)).toBe(false);
    await db.prepare("DELETE FROM team_memberships").run();
    await db.prepare("INSERT INTO roles VALUES ('admin', 'administrator')").run();
    await db.prepare("INSERT INTO user_role_assignments VALUES ('other', 'admin')").run();
    expect(await store.isEligible("team", NOW_MS)).toBe(false);
    await db.prepare("DELETE FROM user_role_assignments").run();
    expect(await new SessionAutoArchiveStore(db, "shadow").isEligible("team", NOW_MS)).toBe(false);
  });

  it("does not treat results predating a viewer's account as unread", async () => {
    await session("old");
    await read("old");
    await db.prepare("INSERT INTO users VALUES ('new', ?)").bind(NOW_MS).run();
    expect(await store.isEligible("old", NOW_MS)).toBe(true);
  });

  it("bounds oldest-first backlog processing and ignores already archived members", async () => {
    await session("oldest", "completed", 5 * DAY_MS);
    await read("oldest");
    await session("newer");
    await read("newer");
    await session("archived-child", "archived", 2 * DAY_MS, "oldest");
    expect(await store.listCandidates(NOW_MS, 1)).toEqual(["oldest"]);
  });
});
