# ─── Multi-stage Dockerfile ──────────────────────────────────────────
#
# Stage 1: Build the frontend (Vite + React → static assets in dist/)
# Stage 2: Plan Rust deps with cargo-chef (cached across builds)
# Stage 3: Build the Rust backend (cargo build --release)
# Stage 4: Runtime — slim image with only the binary + static files
#
# Build:
#   docker build -t vexevn:latest .
#   # With Postgres instead of SQLite:
#   docker build --build-arg BACKEND_FEATURES=postgres -t vexevn:latest .
#
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

# Copy lockfile first for layer caching
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Copy source + build
COPY frontend/ ./
RUN bun run build:client

# Generate PWA icons if sharp is installed (no-op fallback otherwise).
RUN bun run scripts/gen-icons.mjs 2>/dev/null || true

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

# Install build deps. pkg-config + libssl-dev for openssl/rustls.
# ca-certificates for cargo to fetch crates. curl for healthchecks.
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Cook deps from recipe — cached unless recipe.json (i.e. Cargo.toml) changes.
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --no-default-features --features ${BACKEND_FEATURES} --recipe-path recipe.json

# Copy source + build
COPY Cargo.toml Cargo.lock ./
COPY store_macros/ ./store_macros/
COPY migrator/ ./migrator/
COPY src/ ./src/
RUN cargo build --release --no-default-features --features ${BACKEND_FEATURES}

# ════════════════════════════════════════════════════════════════════
# Stage 4: Runtime (minimal — no package manager at runtime)
# ════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS runtime

# Install runtime deps:
# - libssl3: for TLS (reqwest, rustls)
# - ca-certificates: for HTTPS cert validation
# - libsqlite3-0: for SQLite backend (no-op if using Postgres)
# - curl: for healthcheck
# - tini: PID 1 init (proper signal handling)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 ca-certificates libsqlite3-0 curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -s /bin/false -u 1000 app

WORKDIR /app

# Copy binary + frontend dist
COPY --from=builder --chown=root:root --chmod=555 /app/target/release/backend /app/backend
COPY --from=frontend-builder --chown=root:root --chmod=555 /frontend/dist /app/frontend/dist

# Create directories for runtime data
RUN mkdir -p /app/storage /app/data \
    && chown -R app:app /app/storage /app/data

# Default env (overridable via --env-file or -e flags)
ENV RUST_LOG=info,backend=info,tower_http=warn
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=8080
ENV DATABASE_URL=sqlite:./data/app.db?mode=rwc
ENV STATIC_FILES_DIR=./frontend/dist
ENV STORAGE_LOCAL_ROOT=./storage

EXPOSE 8080
USER app

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/backend", "serve"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8080/health || exit 1
