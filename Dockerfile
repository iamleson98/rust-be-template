# --- Build stage ---
# Compile with the sqlite feature by default. Override with --build-arg
# to produce a postgres build:
#   docker build --build-arg BACKEND_FEATURES=postgres -t backend:pg .
FROM rust:1.83-slim AS builder

ARG BACKEND_FEATURES=sqlite

WORKDIR /app

# Install system deps needed to compile:
# - libssl-dev + pkg-config: for rustls/native-tls
# - libsqlite3-dev: for the SQLite backend (if FEATURE=sqlite)
# - musl-tools: for static linking (optional, not used here)
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Cache deps across builds (only re-fetch when Cargo.toml changes).
COPY Cargo.toml Cargo.lock ./
COPY store_macros/ ./store_macros/
RUN mkdir -p src && echo "fn main() {}" > src/main.rs \
    && echo "" > src/lib.rs \
    && cargo build --release 2>/dev/null || true \
    && rm -rf src

# Copy the actual source and build.
COPY . .
RUN cargo build --release --no-default-features --features ${BACKEND_FEATURES}

# --- Runtime stage ---
# Slim runtime image — no compiler toolchain.
FROM debian:bookworm-slim AS runtime

# Install only the runtime libs we need:
# - libssl3: for TLS
# - ca-certificates: for HTTPS
# - libsqlite3-0: only if using sqlite (harmless if not)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    ca-certificates \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary.
COPY --from=builder /app/target/release/backend /app/backend

# Copy the static files + .env.example (user mounts their own .env).
COPY static/ /app/static/
COPY .env.example /app/.env.example

# Default config — override via env vars at runtime.
ENV RUST_LOG=info,backend=debug,tower_http=warn
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATABASE_URL=sqlite:./app.db?mode=rwc

EXPOSE 8080

# Run as non-root for security.
RUN useradd -r -s /bin/false app && chown -R app:app /app
USER app

# Healthcheck via the /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/backend", "db-backend"] || exit 1

ENTRYPOINT ["/app/backend"]
CMD ["serve"]
