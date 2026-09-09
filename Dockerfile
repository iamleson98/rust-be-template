# ─── Multi-stage Dockerfile ──────────────────────────────────────────
#
# Stage 1: Build the frontend (Vite + React → static assets in dist/)
# Stage 2: Plan Rust deps with cargo-chef (cached across builds)
# Stage 3: Build the Rust backend (cargo build --release)
# Stage 4: Runtime — slim image with only the binary + static files
#
# Build:
#   docker build -t datxevui:latest .
#   (No database feature flags — the rust-sql engine is always compiled in.)
#
# Run:
#   docker run -p 8080:8080 --env-file .env datxevui:latest
#
# Persistent data (bind or named volumes):
#   - /app/data     — rust-sql database file + OSM PBF downloads
#   - /app/index    — Tantivy place-search index (see SEARCH_INDEX_DIR)
#   - /app/storage  — local file uploads
#
#   The Tantivy index lives at /app/index/osm-index — NESTED one level
#   inside its volume on purpose: the biweekly osm.import job builds into
#   a sibling staging dir (/app/index/osm-index.staging) and atomically
#   renames it over the live index. Siblings must share a filesystem or
#   rename(2) fails with EXDEV. Do NOT flatten this to /app/osm-index.
#
# Why cargo-chef: caches the deps layer across code changes — saves
# ~3-5 minutes per CI run when Cargo.toml hasn't changed.

# ════════════════════════════════════════════════════════════════════
# Stage 1: Frontend build
# ════════════════════════════════════════════════════════════════════
FROM oven/bun:1.2-alpine AS frontend-builder

WORKDIR /frontend

# Build-time ARGs for SEO/analytics — passed to Vite via ENV.
# VITE_GA4_ID: Google Analytics 4 Measurement ID (e.g. G-XXXXXXXXXX)
# VITE_GSC_VERIFICATION: Google Search Console verification token
ARG VITE_GA4_ID=""
ARG VITE_GSC_VERIFICATION=""
ENV VITE_GA4_ID=$VITE_GA4_ID
ENV VITE_GSC_VERIFICATION=$VITE_GSC_VERIFICATION

# Copy lockfile first for layer caching
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Copy source
COPY frontend/ ./

# Generate PWA icons BEFORE the build so they're included in dist/.
# The script writes to public/icons/ → Vite copies public/ → dist/
# during build. Previously this ran AFTER build, so icons never
# reached dist/.
RUN bun run scripts/gen-icons.mjs 2>/dev/null || true

# Run the FULL build: build:client (Vite) + build:prerender (SEO).
# Previously only build:client ran, so index.html was NOT prerendered
# — GA4/GSC tags stayed as HTML comments.
RUN bun run build

# ════════════════════════════════════════════════════════════════════
# Stage 2: cargo-chef planner
# ════════════════════════════════════════════════════════════════════
# ⚠️ PINNED to the explicit bookworm variant — NOT the floating
# `rust:1.97-slim`. The plain -slim tag silently re-published on a
# Debian trixie base (glibc 2.41) between the v0.2.2 and v0.2.3 builds,
# producing a binary that requires GLIBC_2.39+ while the runtime stage
# below is debian:bookworm-slim (glibc 2.36) → the container crashed on
# boot with `libc.so.6: version 'GLIBC_2.39' not found` and Swarm rolled
# the deploy back. Builder and runtime MUST stay on the same Debian
# release; when upgrading the runtime to trixie, change BOTH lines.
FROM rust:1.97-slim-bookworm AS chef
RUN cargo install cargo-chef --locked --version ^0.1
WORKDIR /app

FROM chef AS planner
# rust-sql/ (engine submodule) is a path dependency of the patched
# libsqlite3-sys → cargo chef must walk it to build the recipe.
# .cargo/config.toml sets RUSTQLITE_LINK_MODE=rlib for every cargo run.
COPY Cargo.toml Cargo.lock ./
COPY .cargo/ .cargo/
COPY rust-sql/ ./rust-sql/
COPY store_macros/ ./store_macros/
COPY migrator/ ./migrator/
RUN cargo chef prepare --recipe-path recipe.json

# ════════════════════════════════════════════════════════════════════
# Stage 3: Build Rust deps + actual binary
# ════════════════════════════════════════════════════════════════════
FROM chef AS builder

# NOTE: no BACKEND_FEATURES arg anymore — the database engine is not a
# cargo feature; every build links the rust-sql (rustqlite) engine
# unconditionally (see the engine block in Cargo.toml).

# Install build deps. pkg-config + libssl-dev for openssl/rustls.
# ca-certificates for cargo to fetch crates. curl for healthchecks.
# cmake: required to build aws-lc-sys (the rustls 0.23 crypto provider,
# pulled in via reqwest/sea-orm and the AWS SDK's modern HTTPS client).
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates curl cmake \
    && rm -rf /var/lib/apt/lists/*

# Cook deps from recipe — cached unless recipe.json (i.e. Cargo.toml) changes.
# cargo-chef's recipe skeletonizes WORKSPACE members only; the [patch.crates-io]
# path dependencies (the rust-sql engine submodule) are NOT members, so they
# must exist on disk before `cook` or cargo cannot resolve the patch.
# .cargo/config.toml must be present too: RUSTQLITE_LINK_MODE=rlib applies to
# every cargo invocation, cook included — without it the compat build script
# defaults to dylib mode and emits flags the final link cannot satisfy (and
# the fingerprint flip would rebuild everything after cook anyway).
# Bonus: the engine + compat compile INSIDE the cached cook layer — app-code
# edits don't recompile the engine.
COPY --from=planner /app/recipe.json recipe.json
COPY Cargo.toml Cargo.lock ./
COPY .cargo/ .cargo/
COPY rust-sql/ ./rust-sql/
RUN cargo chef cook --release --recipe-path recipe.json

# Workspace members + app source: the cook wrote their SKELETONS (manifest
# verbatim, stubbed lib.rs) — copy the real code over them and build.
COPY store_macros/ ./store_macros/
COPY migrator/ ./migrator/
COPY src/ ./src/
RUN cargo build --release

# ════════════════════════════════════════════════════════════════════
# Stage 4: Runtime (minimal — no package manager at runtime)
# ════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS runtime

# Install runtime deps:
# - libssl3: for TLS (reqwest, rustls)
# - ca-certificates: for HTTPS cert validation
# - curl: for healthcheck
# - tini: PID 1 init (proper signal handling)
# NOTE: no sqlite3 CLI and no libsqlite3-0 — the database engine is
# pure-Rust rustqlite compiled INTO the binary (rlib link mode). There
# is no C SQLite anywhere in the image (the legacy C-SQLite → rustqlite
# boot migration and its sqlite3 CLI dependency were removed 2026-09).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -s /bin/false -u 1000 app

ARG VERSION=dev
ARG CREATED=1970-01-01T00:00:00Z

# OCI labels — `docker inspect` shows exactly which git tag built this.
LABEL org.opencontainers.image.title="datxevui" \
      org.opencontainers.image.description="DatXeVui — Rust/Axum backend serving the React frontend, API, WebSocket, and Tantivy place search" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.source="https://github.com/iamleson98/rust-be-template" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Copy binary + frontend dist (read-only: app user cannot tamper with them)
COPY --from=builder --chown=root:root --chmod=555 /app/target/release/backend /app/backend
COPY --from=frontend-builder --chown=root:root --chmod=555 /frontend/dist /app/frontend/dist

# Create directories for runtime data. /app/index is the Tantivy volume
# mount point — the live index sits at /app/index/osm-index (nested, so
# the importer's staging/old SIBLINGS share the volume's filesystem and
# atomic renames never cross a mount boundary → no EXDEV failures).
# Named volumes copy up ownership on FIRST use only, so pre-create them
# here with the right owner.
RUN mkdir -p /app/storage /app/data /app/index \
    && chown -R app:app /app/storage /app/data /app/index

# Default env (overridable via --env-file or -e flags)
ENV RUST_LOG=info,backend=info,tower_http=warn
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=8080
ENV DATABASE_URL=sqlite:./data/app.db?mode=rwc
ENV STATIC_FILES_DIR=./frontend/dist
ENV STORAGE_LOCAL_ROOT=./storage
# Tantivy place-search: index + OSM extract both live on volumes.
ENV SEARCH_INDEX_DIR=/app/index/osm-index
ENV SEARCH_OSM_PBF_PATH=/app/data/vietnam-latest.osm.pbf

EXPOSE 8080
USER app

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/backend", "serve"]

# start-period=60s gives the backend time to:
# 1. Open the DB pool (may need retries if the DB isn't ready yet)
# 2. Apply pending migrations
# 3. Start the Axum server
# On a small 2GB VPS (e.g. Contabo Cloud 4) this can exceed 15s, causing
# orchestrators to mark the task unhealthy and restart-loop it.
# retries=8 (was 5) + timeout 10s (was 5s): a healthcheck kill drops
# EVERY live WebSocket — including in-progress calls. Transient curl
# blips restarting the backend mid-call were observed in production.
# The task is also CPU-capped (1.5 cpus in stack.yml) on a node SHARED
# with the pdf-tts stack: under host contention a 5s curl timeout can
# miss even when the process is fine, and five 30s-interval misses
# (2.5 min) then replaced a healthy task. 8 misses at a 10s timeout =
# 4 minutes of SUSTAINED failure before Swarm replaces the task —
# contention false positives are gone, genuine runtime hangs are still
# caught (recovering in ~4 min instead of ~2.5 min, an acceptable
# trade for not killing live calls).
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=8 \
    CMD curl -sf http://localhost:8080/health || exit 1
