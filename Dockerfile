# ─── Multi-stage Dockerfile ──────────────────────────────────────────
#
# Stage 1: Build the frontend (Vite + React → static assets in dist/)
# Stage 2: Plan Rust deps with cargo-chef (cached across builds)
# Stage 3: Build the Rust backend (cargo build --release)
# Stage 4: Runtime — slim image with only the binary + static files
#
# Build:
#   docker build -t vexevn:latest .
# Run:
#   docker run -p 8080:8080 --env-file .env vexevn:latest
#
# Why cargo-chef: caches the deps layer across code changes — saves
# ~3-5 minutes per CI run when Cargo.toml hasn't changed.

# ════════════════════════════════════════════════════════════════════
# Stage 1: Frontend build
# ════════════════════════════════════════════════════════════════════
FROM oven/bun:1.2-alpine AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
RUN bun run build
# Generate PWA icons if sharp is installed (no-op fallback otherwise).
RUN bun run scripts/gen-icons.mjs || true

# ════════════════════════════════════════════════════════════════════
# Stage 2: cargo-chef planner
# ════════════════════════════════════════════════════════════════════
FROM rust:1.97-slim AS chef
RUN cargo install cargo-chef --locked --version ^0.1
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY store_macros/ ./store_macros/
COPY migrator/ ./migrator/
RUN cargo chef prepare --recipe-path recipe.json

# ════════════════════════════════════════════════════════════════════
# Stage 3: Build Rust deps + actual binary
# ════════════════════════════════════════════════════════════════════
FROM chef AS builder
ARG BACKEND_FEATURES=sqlite

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Cook deps from recipe — cached unless recipe.json (i.e. Cargo.toml) changes.
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --no-default-features --features ${BACKEND_FEATURES} --recipe-path recipe.json

COPY Cargo.toml Cargo.lock ./
COPY store_macros/ ./store_macros/
COPY migrator/ ./migrator/
COPY src/ ./src/
RUN cargo build --release --no-default-features --features ${BACKEND_FEATURES}

# ════════════════════════════════════════════════════════════════════
# Stage 4: Runtime (minimal — no package manager at runtime)
# ════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 ca-certificates libsqlite3-0 curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -s /bin/false -u 1000 app

WORKDIR /app

COPY --from=builder --chown=root:root --chmod=555 /app/target/release/backend /app/backend
COPY --from=frontend-builder --chown=root:root --chmod=555 /frontend/dist /app/frontend/dist
COPY --chown=root:root --chmod=444 .env.example /app/.env.example

RUN mkdir -p /app/storage /app/data /app/osm-index \
    && chown -R app:app /app/storage /app/data /app/osm-index

ENV RUST_LOG=info,backend=info,tower_http=warn
ENV SERVER__HOST=0.0.0.0
ENV SERVER__PORT=8080
ENV DATABASE__URL=sqlite:./app.db?mode=rwc
ENV STATIC_FILES__DIR=./frontend/dist
ENV STORAGE__LOCAL_ROOT=./storage
ENV SEARCH__INDEX_DIR=./osm-index

EXPOSE 8080
USER app

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/backend", "serve"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8080/health || exit 1
