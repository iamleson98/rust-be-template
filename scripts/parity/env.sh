#!/usr/bin/env bash
# Shared settings for the parity scripts. Source it; override any variable first.
#
#   PARITY_WORK  work directory (stage.db, the imported app.db, the REF copy, logs)
#   REF_SRC      read-only checkout of the Cloudflare reference (its cloudflare/ folder is copied)
#   REF_PORT     port of the REF `next dev` (local D1, never a Cloudflare account)
#   RUST_PORT    port of the Rust server
#   RUST_BIN     the `backend` binary, built with CARGO_TARGET_DIR=... cargo build --bin backend
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${PARITY_WORK:=${TMPDIR:-/tmp}/datxevui-parity}"
: "${REF_SRC:=$ROOT/../cf-ref}"
: "${REF_PORT:=3001}"
: "${RUST_PORT:=3102}"
: "${RUST_BIN:=${CARGO_TARGET_DIR:-$ROOT/target}/debug/backend}"
: "${JWT_SECRET:=local-parity-secret-at-least-32-bytes-long-aaaa}"
export ROOT PARITY_WORK REF_SRC REF_PORT RUST_PORT RUST_BIN JWT_SECRET
