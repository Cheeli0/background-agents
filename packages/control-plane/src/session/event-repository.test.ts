import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { SandboxEvent } from "@open-inspect/shared/types/sandbox-events";
import { createNodeSqlStorage } from "../node/sqlite-storage";
import { EventRepository } from "./event-repository";
import { initSchema } from "./schema";

type TokenEvent = Extract<SandboxEvent, { type: "token" }>;
type ToolCallEvent = Extract<SandboxEvent, { type: "tool_call" }>;

interface StoredEvent {
  id: string;
  data: string;
  message_id: string | null;
  created_at: number;
}

function createRepository() {
  const db = new DatabaseSync(":memory:");
  const { sql, transactionSync } = createNodeSqlStorage(db);
  initSchema(sql);
  const repository = new EventRepository(sql, transactionSync);
  const rows = () =>
    sql
      .exec("SELECT id, data, message_id, created_at FROM events ORDER BY id")
      .toArray() as unknown as StoredEvent[];
  return { db, repository, rows };
}

function token(content: string, partId?: string): TokenEvent {
  return {
    type: "token",
    sandboxId: "sb-1",
    timestamp: 1,
    messageId: "msg-1",
    content,
    ...(partId ? { partId } : {}),
  };
}

describe("EventRepository upserts (SQLite)", () => {
  it("moves a message-level token to the latest frame's time", () => {
    const { db, repository, rows } = createRepository();
    try {
      repository.upsertTokenEvent("msg-1", token("Hel"), 1_000);
      repository.upsertTokenEvent("msg-1", token("Hello"), 2_000);
      expect(rows()).toEqual([
        {
          id: "token:msg-1",
          data: JSON.stringify(token("Hello")),
          message_id: "msg-1",
          created_at: 2_000,
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("keeps a part token at its first frame's time", () => {
    const { db, repository, rows } = createRepository();
    try {
      repository.upsertTokenEvent("msg-1", token("Hel", "part-1"), 1_000);
      repository.upsertTokenEvent("msg-1", token("Hello", "part-1"), 2_000);
      expect(rows()).toEqual([
        {
          id: `token-part:${JSON.stringify(["msg-1", "part-1"])}`,
          data: JSON.stringify(token("Hello", "part-1")),
          message_id: "msg-1",
          created_at: 1_000,
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("updates a tool call in place and keeps its first time", () => {
    const { db, repository, rows } = createRepository();
    const toolCall = (status: string): ToolCallEvent =>
      ({
        type: "tool_call",
        sandboxId: "sb-1",
        timestamp: 1,
        messageId: "msg-1",
        tool: "bash",
        callId: "call-1",
        args: {},
        status,
      }) as ToolCallEvent;
    try {
      repository.upsertToolCallEvent("msg-1", toolCall("running"), 1_000);
      repository.upsertToolCallEvent("msg-1", toolCall("completed"), 2_000);
      const [row] = rows();
      expect(rows()).toHaveLength(1);
      expect(row).toMatchObject({ message_id: "msg-1", created_at: 1_000 });
      expect(JSON.parse(row.data)).toMatchObject({ status: "completed" });
    } finally {
      db.close();
    }
  });
});
