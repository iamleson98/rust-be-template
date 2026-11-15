#!/usr/bin/env bash
# d1-export.sh — assemble a stage database from a remote Cloudflare D1.
#
#   scripts/d1-export.sh --database DB_NAME [--config wrangler.jsonc] [--out stage.db]
#                        [--allow-writes]
#   backend import-d1 --stage stage.db --out app.db --report report.json
#
# `wrangler d1 export` refuses a database that holds virtual tables
# (place_fts, from the Worker's migration 0001), so the database is read
# table by table: for every real table, its schema (--no-data) and then its
# rows (--no-schema). The result is one plain SQLite file with D1's own
# schema and rows, nothing converted: that is what `import-d1` reads.
#
# Left out: d1_migrations and sqlite_* / _cf_* (D1 bookkeeping), and
# place_fts* (the FTS5 index and its shadow tables; they are rebuilt from the
# place table, and the app does not use them). The place triggers that feed
# that index are dropped from the stage, since their target is not there.
#
# For the real cutover, freeze writes first (the WAF rule that answers 503 to
# non-GET /api/*, with the Worker's cron removed). The script counts every
# table on the remote before and after the export and again in the stage, and
# fails unless all three agree: a write that slipped in, or a truncated
# export, cannot go unnoticed. --allow-writes turns that into a warning for a
# dry run against a live site.
#
# Needs: wrangler (WRANGLER="bunx wrangler" to change how it is started;
# default `npx wrangler`), already logged in (or CLOUDFLARE_API_TOKEN set),
# and the sqlite3 CLI. Read-only against Cloudflare: it never writes to D1.
set -euo pipefail

usage() {
  echo "usage: d1-export.sh --database NAME [--config FILE] [--out stage.db] [--allow-writes]" >&2
  exit 2
}

database=""
config=""
out="stage.db"
allow_writes=false
while [ $# -gt 0 ]; do
  case "$1" in
    --database) database="${2:?--database needs a value}"; shift 2 ;;
    --config) config="${2:?--config needs a value}"; shift 2 ;;
    --out) out="${2:?--out needs a value}"; shift 2 ;;
    --allow-writes) allow_writes=true; shift ;;
    *) usage ;;
  esac
done
[ -n "$database" ] || usage

command -v sqlite3 >/dev/null || { echo "the sqlite3 CLI is not installed" >&2; exit 1; }
read -r -a wrangler <<< "${WRANGLER:-npx wrangler}"
command -v "${wrangler[0]}" >/dev/null || { echo "${wrangler[0]} is not installed" >&2; exit 1; }
if [ -e "$out" ]; then
  echo "$out already exists; remove it first (the stage is always built from scratch)" >&2
  exit 1
fi

config_args=()
if [ -n "$config" ]; then
  config_args=(--config "$config")
fi

work="$(mktemp -d)"
partial="$out.part"
trap 'rm -rf "$work" "$partial"' EXIT
rm -f "$partial"

# wrangler d1 <args...>, always against the remote database.
d1() {
  "${wrangler[@]}" d1 "$@" --remote ${config_args[@]+"${config_args[@]}"}
}

# The result rows of one remote query, as one line of JSON without spaces.
remote_rows() {
  d1 execute "$database" --json --command "$1" | tr -d '\n\r\t '
}

echo "==> listing the tables of $database"
tables=()
skipped=()
while IFS= read -r name; do
  [ -n "$name" ] || continue
  case "$name" in
    d1_migrations|sqlite_*|_cf_*|place_fts*) skipped+=("$name") ;;
    *) tables+=("$name") ;;
  esac
done < <(remote_rows "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name" \
  | grep -o '"name":"[^"]*"' | sed 's/"name":"\(.*\)"/\1/')
[ "${#tables[@]}" -gt 0 ] || { echo "no tables found (wrong database name or not logged in?)" >&2; exit 1; }
echo "    ${#tables[@]} tables to export; left out: ${skipped[*]:-none}"

# "table count" lines for every exported table, sorted. Compound SELECTs are
# kept short (D1 limits their size).
remote_counts() {
  local i=0 sql="" t
  for t in "${tables[@]}"; do
    sql+="${sql:+ UNION ALL }SELECT '$t' AS t, COUNT(*) AS n FROM \"$t\""
    i=$((i + 1))
    if [ $((i % 5)) -eq 0 ] || [ "$i" -eq "${#tables[@]}" ]; then
      remote_rows "$sql" | grep -o '"t":"[^"]*","n":[0-9]*' \
        | sed 's/"t":"\([^"]*\)","n":\([0-9]*\)/\1 \2/'
      sql=""
    fi
  done | sort
}

echo "==> row counts before the export"
remote_counts > "$work/before.txt"
[ -s "$work/before.txt" ] || { echo "the remote answered no row counts" >&2; exit 1; }

echo "==> schemas"
for t in "${tables[@]}"; do
  d1 export "$database" --table "$t" --no-data --output "$work/$t.schema.sql" > /dev/null
  sqlite3 -bail "$partial" < "$work/$t.schema.sql"
done
# Triggers of the FTS5 index (place_ai, place_ad, place_au) point at tables
# that are not here and would fail the first place INSERT.
sqlite3 "$partial" "SELECT name FROM sqlite_master WHERE type = 'trigger'" | while IFS= read -r trigger; do
  sqlite3 "$partial" "DROP TRIGGER \"$trigger\""
done

echo "==> rows"
for t in "${tables[@]}"; do
  d1 export "$database" --table "$t" --no-schema --output "$work/$t.data.sql" > /dev/null
  { echo "PRAGMA synchronous = OFF;"; cat "$work/$t.data.sql"; } | sqlite3 -bail "$partial"
done

echo "==> row counts after the export"
remote_counts > "$work/after.txt"
for t in "${tables[@]}"; do
  echo "$t $(sqlite3 "$partial" "SELECT COUNT(*) FROM \"$t\"")"
done | sort > "$work/stage.txt"

check="$(sqlite3 "$partial" "PRAGMA integrity_check")"
if [ "$check" != ok ]; then
  echo "the stage fails integrity_check: $check" >&2
  exit 1
fi

status=0
if ! diff -u "$work/before.txt" "$work/after.txt" > "$work/writes.diff"; then
  echo "rows changed on the remote while the export ran (was the Worker frozen?):" >&2
  cat "$work/writes.diff" >&2
  status=1
fi
if ! diff -u "$work/after.txt" "$work/stage.txt" > "$work/stage.diff"; then
  echo "the stage does not hold what the remote holds:" >&2
  cat "$work/stage.diff" >&2
  status=1
fi
if [ "$status" -ne 0 ] && ! $allow_writes; then
  exit "$status"
fi
if [ "$status" -ne 0 ]; then
  echo "warning: differences accepted (--allow-writes); this stage is a dry-run snapshot" >&2
fi

mv "$partial" "$out"
echo "==> $out: ${#tables[@]} tables, $(awk '{n += $2} END {print n}' "$work/stage.txt") rows"
