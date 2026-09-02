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
DATABASE_URL="sqlite:///tmp/vexevn/app.db?mode=rwc" \
JWT_SECRET="dev-secret-for-local-testing-only-0123456789" \
SEARCH_INDEX_DIR="./search-index" \
CORS_ORIGINS="http://localhost:5184,http://127.0.0.1:5184,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173" \
RUST_LOG="warn" \
exec ./target/debug/backend >> "$LOG" 2>&1
