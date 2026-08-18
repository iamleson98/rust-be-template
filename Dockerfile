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
FROM node:22-slim AS frontend-builder

WORKDIR /frontend

# Copy package files and install deps.
# Bun is used for the build script (bun run build:client && bun run build:prerender)
# but we install via npm to avoid needing bun in the image.
COPY frontend/package.json frontend/bun.lock* frontend/package-lock.json* ./
RUN npm install

# Copy the rest of the frontend source.
COPY frontend/ ./

# Build the frontend. Output goes to ./dist.
# The prerender step needs node, which is available in this image.
RUN npm run build

# ════════════════════════════════════════════════════════════════════
# Stage 2: Backend build
# ════════════════════════════════════════════════════════════════════
FROM rust:1.97-slim AS backend-builder

ARG BACKEND_FEATURES=sqlite

WORKDIR /app

# Install system deps needed to compile:
# - pkg-config + libssl-dev: for rustls/native-tls
# - ca-certificates: for HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    ca-certificates \
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
# Stage 3: Runtime (slim image — no compiler toolchain)
# ════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS runtime

# Install only the runtime libs we need.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    ca-certificates \
    libsqlite3-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary.
COPY --from=backend-builder /app/target/release/backend /app/backend

# Copy the frontend build output — the backend serves these as static files.
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

# Copy the .env.example (user mounts their own .env at runtime).
COPY .env.example /app/.env.example

# Create directories for runtime data.
RUN mkdir -p /app/storage /app/data && \
    chown -R root:root /app

# Default config — override via env vars or .env at runtime.
ENV RUST_LOG=info,backend=info,tower_http=warn
ENV SERVER__HOST=0.0.0.0
ENV SERVER__PORT=8080
ENV DATABASE__URL=sqlite:./app.db?mode=rwc
ENV STATIC_FILES__DIR=./frontend/dist
ENV STORAGE__LOCAL_ROOT=./storage
ENV SEARCH__INDEX_DIR=./osm-index

EXPOSE 8080

# Run as non-root for security.
RUN useradd -r -s /bin/false app && chown -R app:app /app
USER app

# Healthcheck via the /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/backend"]
CMD ["serve"]
