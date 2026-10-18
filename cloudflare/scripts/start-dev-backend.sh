#!/bin/bash
# Dev backend for browser verification (fresh seeded DB).
set -u
export DATABASE_URL="sqlite:/home/z/my-project/dev-data/app.db?mode=rwc"
export SERVER_PORT=8080
export SERVER_HOST=127.0.0.1
export JWT_SECRET="dev-secret-for-local-verification-only"
export RUST_LOG="info,warn"
export DATABASE_CACHE_KIB=65536
export CORS_ORIGINS="http://localhost:3000,http://localhost:5173"
exec /home/z/rust-be-template/target/debug/backend
