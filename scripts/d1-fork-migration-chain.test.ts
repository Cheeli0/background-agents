import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migrationsDirectory = join(import.meta.dirname, "..", "terraform", "d1", "migrations");
const migrationRunnerPath = join(import.meta.dirname, "d1-migrate.sh");
const forkMigrationNames = [
  "0017_add_creation_source_to_sessions.sql",
  "0018_add_branch_name_to_sessions.sql",
  "0019_add_analytics_columns.sql",
  "0020_create_mcp_servers.sql",
  "0021_create_users.sql",
  "0022_add_sessions_updated_at_index.sql",
] as const;

function migrationFiles(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function applyMigration(database: DatabaseSync, name: string): void {
  database.exec(readFileSync(join(migrationsDirectory, name), "utf8"));
}

function schema(database: DatabaseSync): string[] {
  return database
    .prepare(
      `SELECT type || ':' || name || ':' || COALESCE(sql, '') AS definition
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%' AND name != '_schema_migrations'
       ORDER BY type, name`
    )
    .all()
    .map((row) => String(row.definition));
}

test("the reconciled migration chain preserves the deployed fork ledger", () => {
  const files = migrationFiles();
  assert.deepEqual(files.slice(16, 22), forkMigrationNames);

  const fresh = new DatabaseSync(":memory:");
  for (const name of files) applyMigration(fresh, name);

  const upgraded = new DatabaseSync(":memory:");
  for (const name of files.slice(0, 22)) applyMigration(upgraded, name);
  upgraded.exec(
    `CREATE TABLE _schema_migrations (
       version TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  );
  const insertLedger = upgraded.prepare(
    "INSERT INTO _schema_migrations (version, name) VALUES (?, ?)"
  );
  for (const name of files.slice(0, 22)) {
    insertLedger.run(name.slice(0, 4), name);
  }
  for (const name of files.slice(22)) applyMigration(upgraded, name);

  assert.deepEqual(schema(upgraded), schema(fresh));
});

test("the remote D1 bootstrap command stays on one line", () => {
  const runner = readFileSync(migrationRunnerPath, "utf8");
  const command = runner.match(
    /--command "([^"]*CREATE TABLE IF NOT EXISTS _schema_migrations[^"]*)"/
  )?.[1];

  assert.ok(command, "expected the migration ledger bootstrap command");
  assert.doesNotMatch(command, /\r?\n/);
});
