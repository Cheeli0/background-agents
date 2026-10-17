/**
 * Fork-only: per-statement SQLite usage for the session Durable Object.
 *
 * Cloudflare bills Durable Object SQLite by rows read and rows written (index
 * entries included), but its analytics only report per-namespace totals. This
 * meter wraps the object's `SqlStorage`, folds each cursor's `rowsRead` /
 * `rowsWritten` into per-statement totals, and logs the totals as one
 * `do.sql_usage` event per window so the dominant write sources can be ranked
 * from Workers logs.
 *
 * It flushes lazily from `exec` (and on demand) rather than on a timer: a
 * pending timer would keep the object from hibernating. Totals still in
 * memory when the object is evicted are lost, which bounds the error to one
 * window per activation.
 */

import type { Logger } from "../logger";
import type { SqlResult, SqlStorage } from "../session/sql-storage";

/** Minimum time between `do.sql_usage` events from one activation. */
export const SQL_USAGE_FLUSH_INTERVAL_MS = 60_000;
/** Distinct statements tracked per window; the rest are pooled as `other`. */
export const SQL_USAGE_MAX_STATEMENTS = 200;
/** Statements listed in each event, ordered by rows written. */
export const SQL_USAGE_TOP_STATEMENTS = 10;
const STATEMENT_KEY_MAX_CHARS = 160;
const OTHER_STATEMENTS_KEY = "other";

interface StatementUsage {
  count: number;
  rowsRead: number;
  rowsWritten: number;
}

export interface SqlUsageMeter {
  /** The object's SQL storage, metered. */
  readonly sql: SqlStorage;
  /** Route `do.sql_usage` events to the session logger once it exists. */
  attach(log: Logger): void;
  /** Emit the current window now if anything was recorded. */
  flush(): void;
}

/** Collapse whitespace and bind-parameter lists so one statement is one key. */
export function sqlStatementKey(query: string): string {
  const key = query
    .replace(/\s+/g, " ")
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, "(?, …)")
    .trim();
  return key.length > STATEMENT_KEY_MAX_CHARS ? `${key.slice(0, STATEMENT_KEY_MAX_CHARS)}…` : key;
}

export function createSqlUsageMeter(
  inner: SqlStorage,
  now: () => number = Date.now
): SqlUsageMeter {
  const keys = new Map<string, string>();
  let usage = new Map<string, StatementUsage>();
  let windowStart = now();
  let log: Logger | null = null;
  // Cursor counts grow as the caller consumes it, so the latest cursor is
  // read on the next exec or flush, after its caller has finished with it.
  let pending: { key: string; result: SqlResult } | null = null;

  const keyFor = (query: string): string => {
    let key = keys.get(query);
    if (key === undefined) {
      key = sqlStatementKey(query);
      keys.set(query, key);
    }
    return key;
  };

  const settlePending = (): void => {
    if (!pending) return;
    const { key, result } = pending;
    pending = null;
    let entry = usage.get(key);
    if (!entry) {
      const bucket = usage.size < SQL_USAGE_MAX_STATEMENTS ? key : OTHER_STATEMENTS_KEY;
      entry = usage.get(bucket);
      if (!entry) {
        entry = { count: 0, rowsRead: 0, rowsWritten: 0 };
        usage.set(bucket, entry);
      }
    }
    entry.count += 1;
    entry.rowsRead += result.rowsRead ?? 0;
    entry.rowsWritten += result.rowsWritten ?? 0;
  };

  const flush = (): void => {
    settlePending();
    const flushedAt = now();
    if (!log || usage.size === 0) return;
    let statements = 0;
    let rowsRead = 0;
    let rowsWritten = 0;
    for (const entry of usage.values()) {
      statements += entry.count;
      rowsRead += entry.rowsRead;
      rowsWritten += entry.rowsWritten;
    }
    const top = [...usage.entries()]
      .sort(([, a], [, b]) => b.rowsWritten - a.rowsWritten || b.rowsRead - a.rowsRead)
      .slice(0, SQL_USAGE_TOP_STATEMENTS)
      .map(([sql, entry]) => ({
        sql,
        count: entry.count,
        rows_read: entry.rowsRead,
        rows_written: entry.rowsWritten,
      }));
    log.info("do.sql_usage", {
      event: "do.sql_usage",
      window_ms: flushedAt - windowStart,
      statement_count: statements,
      rows_read: rowsRead,
      rows_written: rowsWritten,
      top_statements: top,
    });
    usage = new Map();
    windowStart = flushedAt;
  };

  const sql: SqlStorage = {
    exec(query: string, ...params: unknown[]): SqlResult {
      settlePending();
      if (log && usage.size > 0 && now() - windowStart >= SQL_USAGE_FLUSH_INTERVAL_MS) flush();
      const result = inner.exec(query, ...params);
      pending = { key: keyFor(query), result };
      return result;
    },
  };

  return {
    sql,
    attach(logger: Logger): void {
      log = logger;
    },
    flush,
  };
}
