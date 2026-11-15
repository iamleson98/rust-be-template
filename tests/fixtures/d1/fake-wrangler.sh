#!/usr/bin/env bash
# A stand-in for the two `wrangler d1` commands scripts/d1-export.sh uses, serving
# a local SQLite file ($FAKE_D1_DB) as if it were the remote D1. It lets the
# export script run end to end in a test without a Cloudflare account.
#
#   d1 execute NAME --json --command SQL      -> [{"results": [...], "success": true}]
#   d1 export NAME --table T --no-data|--no-schema --output FILE
#
# FAKE_D1_WRITE=<sql> runs that statement once, on the first row count asked
# after an export: a write that lands while the export is running.
set -euo pipefail
db="${FAKE_D1_DB:?FAKE_D1_DB is not set}"
[ "$1" = d1 ] || { echo "fake wrangler: only d1" >&2; exit 2; }
sub="$2"
shift 3

command=""
table=""
output=""
no_data=false
no_schema=false
while [ $# -gt 0 ]; do
  case "$1" in
    --command) command="$2"; shift 2 ;;
    --table) table="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    --config) shift 2 ;;
    --no-data) no_data=true; shift ;;
    --no-schema) no_schema=true; shift ;;
    *) shift ;;
  esac
done

marker="$db.exported"
case "$sub" in
  execute)
    if [ -n "${FAKE_D1_WRITE:-}" ] && [ -e "$marker" ] && [ ! -e "$db.written" ]; then
      sqlite3 "$db" "$FAKE_D1_WRITE"
      : > "$db.written"
    fi
    rows="$(sqlite3 -json "$db" "$command")"
    printf '[{"results": %s, "success": true}]\n' "${rows:-[]}"
    ;;
  export)
    : > "$marker"
    if $no_data; then
      sqlite3 "$db" ".schema \"$table\"" > "$output"
    elif $no_schema; then
      sqlite3 "$db" ".mode insert \"$table\"" "SELECT * FROM \"$table\"" > "$output"
    else
      echo "fake wrangler: export needs --no-data or --no-schema" >&2
      exit 2
    fi
    ;;
  *) echo "fake wrangler: unsupported d1 command $sub" >&2; exit 2 ;;
esac
