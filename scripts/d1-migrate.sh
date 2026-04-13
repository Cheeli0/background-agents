#!/usr/bin/env bash
set -euo pipefail

DATABASE_NAME="${1:?Usage: d1-migrate.sh <database-name> [migrations-dir]}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="${2:-$SCRIPT_DIR/../terraform/d1/migrations}"

WRANGLER="npx wrangler"

# Keep bootstrap SQL as one statement to avoid shell/newline parsing edge cases.
CREATE_MIGRATIONS_TABLE_SQL="CREATE TABLE IF NOT EXISTS _schema_migrations (version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));"

# 1. Ensure tracking table exists
$WRANGLER d1 execute "$DATABASE_NAME" --remote \
  --command "$CREATE_MIGRATIONS_TABLE_SQL"

# 2. Get applied versions (parse JSON output)
APPLIED=$($WRANGLER d1 execute "$DATABASE_NAME" --remote \
  --command "SELECT version FROM _schema_migrations ORDER BY version" \
  --json | jq -r '.[0].results[].version // empty' 2>/dev/null || echo "")

# Guard against ambiguous migration state. The runner keys migrations by their
# numeric prefix, so duplicate prefixes would cause one file to mask another.
DUPLICATE_VERSIONS=$(
  for file in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$file" ] || continue
    basename "$file" | grep -oE '^[0-9]+'
  done | sort | uniq -d
)

if [ -n "$DUPLICATE_VERSIONS" ]; then
  echo "Error: duplicate migration version prefixes found in $MIGRATIONS_DIR:" >&2
  echo "$DUPLICATE_VERSIONS" | sed 's/^/  - /' >&2
  echo "Rename the conflicting migration files so each numeric prefix is unique." >&2
  exit 1
fi

# 3. Apply pending migrations in order
COUNT=0
for file in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$file" ] || continue
  FILENAME=$(basename "$file")
  VERSION=$(echo "$FILENAME" | grep -oE '^[0-9]+')

  if echo "$APPLIED" | grep -qxF "$VERSION"; then
    echo "Skip (already applied): $FILENAME"
    continue
  fi

  echo "Applying: $FILENAME"
  $WRANGLER d1 execute "$DATABASE_NAME" --remote --file "$file"

  SAFE_FILENAME=$(echo "$FILENAME" | sed "s/'/''/g")
  $WRANGLER d1 execute "$DATABASE_NAME" --remote \
    --command "INSERT INTO _schema_migrations (version, name) VALUES ('$VERSION', '$SAFE_FILENAME')"

  COUNT=$((COUNT + 1))
done

echo "Done. Applied $COUNT migration(s)."
