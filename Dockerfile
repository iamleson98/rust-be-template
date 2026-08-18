# ─── Multi-stage Dockerfile ──────────────────────────────────────────
#
# Stage 1: Build the frontend (Vite + React → static assets in dist/)
# Stage 2: Build the Rust backend (cargo build --release)
# Stage 3: Runtime — slim image with only the binary + static files
#
# The backend serves the frontend's dist/ as static content via
# tower-http's ServeDir (see src/routes/router.rs). No nginx needed.
#
# Build:
#   docker build -t vexevn:latest .
# Run:
#   docker run -p 8080:8080 --env-file .env vexevn:latest

# ════════════════════════════════════════════════════════════════════
# Stage 1: Frontend build
# ════════════════════════════════════════════════════════════════════
FROM oven/bun:1 AS frontend-builder

WORKDIR /frontend

# Copy package files and install dependencies from the Bun lockfile.
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile

# Copy the rest of the frontend source.
COPY frontend/ ./

# Build the frontend. Output goes to ./dist.
RUN bun run build

# ════════════════════════════════════════════════════════════════════
# Stage 2: Backend build
# ════════════════════════════════════════════════════════════════════
FROM rust:1.97-slim AS backend-builder

ARG BACKEND_FEATURES=sqlite

WORKDIR /app

# Install system deps needed to compile:
# - pkg-config + libssl-dev: for rustls/native-tls
# - ca-certificates: for HTTPS
# - curl: for downloading Swagger UI during the utoipa-swagger-ui build
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cache deps across builds (only re-fetch when Cargo.toml changes).
COPY Cargo.toml Cargo.lock ./
COPY store_macros/ ./store_macros/
COPY migrator/ ./migrator/
RUN mkdir -p src && echo "fn main() {}" > src/main.rs \
    && echo "" > src/lib.rs \
    && cargo build --release 2>/dev/null || true \
    && rm -rf src

# Copy the actual source and build.
COPY . .

# Build the backend binary.
RUN cargo build --release --no-default-features --features ${BACKEND_FEATURES}

# ════════════════════════════════════════════════════════════════════
# Stage 3: Runtime (minimal — no package manager at runtime)
# ════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS runtime

# Install runtime deps + create non-root user in one layer.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    ca-certificates \
    libsqlite3-0 \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -s /bin/false -u 1000 app

WORKDIR /app

# Copy the compiled binary (owned by root, readable by app).
COPY --from=backend-builder --chown=root:root --chmod=555 /app/target/release/backend /app/backend

# Copy the frontend build output.
COPY --from=frontend-builder --chown=root:root --chmod=555 /frontend/dist /app/frontend/dist

# Copy .env.example (user mounts their own .env at runtime).
COPY --chown=root:root --chmod=444 .env.example /app/.env.example

# Create writable directories for runtime data (app.db, uploads, osm-index).
RUN mkdir -p /app/storage /app/data /app/osm-index \
    && chown -R app:app /app/storage /app/data /app/osm-index

# Default config — override via env vars or .env at runtime.
ENV RUST_LOG=info,backend=info,tower_http=warn
ENV SERVER__HOST=0.0.0.0
ENV SERVER__PORT=8080
ENV DATABASE__URL=sqlite:./app.db?mode=rwc
ENV STATIC_FILES__DIR=./frontend/dist
ENV STORAGE__LOCAL_ROOT=./storage
ENV SEARCH__INDEX_DIR=./osm-index

EXPOSE 8080

USER app

# tini as PID 1 — proper signal handling (SIGTERM → graceful shutdown).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/backend", "serve"]

# Healthcheck via /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8080/health || exit 1
