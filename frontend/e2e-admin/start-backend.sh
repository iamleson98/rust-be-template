#!/usr/bin/env bash
# Started by playwright.admin.config.ts — boots the Rust backend with the
# dev SQLite DB + seeded Tantivy index. Reused if already running.
#
# CORS_ORIGINS must include the Playwright dev-server origin
# (http://localhost:5184) — the backend's anti-scraping middleware
# rejects mutations whose Referer/Origin is not on the list.
set -u
REPO="/home/z/my-project/rust-be-template"
LOG="/tmp/vexevn/backend.log"
export PATH="$HOME/.cargo/bin:$PATH"
health() { curl -s --max-time 5 -A "Mozilla/5.0" http://127.0.0.1:8080/health 2>/dev/null | grep -q '"ok"'; }
if health; then exit 0; fi
cd "$REPO"
# Seed a deterministic cron-jobs state (enabled, far-future next run,
# exactly one succeeded history run) so /admin/cron-jobs has stable
# content and no run can poison the next (toggles / edits from a
# previous failed run are reset). Uses python3's stdlib sqlite — no
# sqlite3 CLI dependency.
python3 - << 'PYEOF'
import sqlite3, uuid
from datetime import datetime, timedelta, timezone
db = sqlite3.connect("/tmp/vexevn/app.db")
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
next_run = (datetime.now(timezone.utc) + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%SZ")
db.execute(
    "INSERT OR IGNORE INTO scheduled_job (id, job_type, enabled, interval_days, at_hour, at_minute, next_run_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    (uuid.uuid4().bytes, "osm.import", 1, 14, 2, 0, next_run, now, now),
)
db.execute(
    "UPDATE scheduled_job SET enabled=1, interval_days=14, at_hour=2, at_minute=0, next_run_at=?, updated_at=? WHERE job_type='osm.import'",
    (next_run, now),
)
db.execute("DELETE FROM job_run WHERE job_type='osm.import'")
db.execute(
    "INSERT INTO job_run (id, job_type, status, detail, error, started_at, finished_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
    (uuid.uuid4().bytes, "osm.import", "succeeded",
     '{"phase":"done","message":"indexed 30 places"}', None,
     "2026-08-18T18:00:00Z", "2026-08-18T18:41:00Z", "2026-08-18T17:59:00Z"),
)
db.commit()
PYEOF
DATABASE_URL="sqlite:///tmp/vexevn/app.db?mode=rwc" \
JWT_SECRET="dev-secret-for-local-testing-only-0123456789" \
SEARCH_INDEX_DIR="./search-index" \
SCHEDULER_ENABLED="false" \
CORS_ORIGINS="http://localhost:5184,http://127.0.0.1:5184,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173" \
RUST_LOG="warn" \
exec ./target/debug/backend >> "$LOG" 2>&1
