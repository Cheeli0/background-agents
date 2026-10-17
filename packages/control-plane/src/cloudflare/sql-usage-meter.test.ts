import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import type { SqlResult, SqlStorage } from "../session/sql-storage";
import {
  createSqlUsageMeter,
  SQL_USAGE_FLUSH_INTERVAL_MS,
  SQL_USAGE_MAX_STATEMENTS,
  sqlStatementKey,
} from "./sql-usage-meter";

interface FakeCursor extends SqlResult {
  rowsRead: number;
  rowsWritten: number;
}

function createFakeSql(usage: Record<string, { read: number; written: number }>) {
  const cursors: FakeCursor[] = [];
  const sql: SqlStorage = {
    exec(query: string): SqlResult {
      const { read, written } = usage[query] ?? { read: 0, written: 0 };
      // Counts are zero until the caller consumes the cursor, like a real one.
      const cursor: FakeCursor = {
        rowsRead: 0,
        rowsWritten: 0,
        toArray() {
          cursor.rowsRead = read;
          cursor.rowsWritten = written;
          return [];
        },
        one() {
          return cursor.toArray()[0];
        },
      };
      cursors.push(cursor);
      return cursor;
    },
  };
  return { sql, cursors };
}

function createLog() {
  const info = vi.fn();
  return { log: { info } as unknown as Logger, info };
}

describe("sqlStatementKey", () => {
  it("collapses whitespace and bind lists", () => {
    expect(sqlStatementKey("SELECT *\n   FROM t WHERE id IN (?, ?,  ?)")).toBe(
      "SELECT * FROM t WHERE id IN (?, …)"
    );
  });
});

describe("createSqlUsageMeter", () => {
  it("attributes consumed cursor counts to their statement", () => {
    const { sql } = createFakeSql({
      "INSERT INTO events": { read: 0, written: 3 },
      "SELECT 1": { read: 5, written: 0 },
    });
    const { log, info } = createLog();
    const meter = createSqlUsageMeter(sql);
    meter.attach(log);

    meter.sql.exec("INSERT INTO events").toArray();
    meter.sql.exec("INSERT INTO events").toArray();
    meter.sql.exec("SELECT 1").toArray();
    meter.flush();

    expect(info).toHaveBeenCalledOnce();
    const [, data] = info.mock.calls[0];
    expect(data).toMatchObject({
      event: "do.sql_usage",
      statement_count: 3,
      rows_read: 5,
      rows_written: 6,
    });
    expect(data.top_statements[0]).toEqual({
      sql: "INSERT INTO events",
      count: 2,
      rows_read: 0,
      rows_written: 6,
    });
  });

  it("emits at most once per interval from exec", () => {
    let clock = 0;
    const { sql } = createFakeSql({ W: { read: 0, written: 1 } });
    const { log, info } = createLog();
    const meter = createSqlUsageMeter(sql, () => clock);
    meter.attach(log);

    meter.sql.exec("W").toArray();
    clock = SQL_USAGE_FLUSH_INTERVAL_MS - 1;
    meter.sql.exec("W").toArray();
    expect(info).not.toHaveBeenCalled();

    clock = SQL_USAGE_FLUSH_INTERVAL_MS;
    meter.sql.exec("W").toArray();
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][1]).toMatchObject({ statement_count: 2, rows_written: 2 });
  });

  it("holds usage until a logger is attached", () => {
    const { sql } = createFakeSql({ W: { read: 0, written: 1 } });
    const { log, info } = createLog();
    const meter = createSqlUsageMeter(sql);

    meter.sql.exec("W").toArray();
    meter.flush();
    meter.attach(log);
    meter.flush();

    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][1]).toMatchObject({ rows_written: 1 });
  });

  it("pools statements beyond the cap", () => {
    const { sql } = createFakeSql({});
    const { log, info } = createLog();
    const meter = createSqlUsageMeter(sql);
    meter.attach(log);

    for (let i = 0; i <= SQL_USAGE_MAX_STATEMENTS; i++) meter.sql.exec(`SELECT ${i}`);
    meter.flush();

    expect(info.mock.calls[0][1].statement_count).toBe(SQL_USAGE_MAX_STATEMENTS + 1);
  });

  it("skips empty windows", () => {
    const { log, info } = createLog();
    const meter = createSqlUsageMeter(createFakeSql({}).sql);
    meter.attach(log);
    meter.flush();
    expect(info).not.toHaveBeenCalled();
  });
});
