#!/usr/bin/env bash
# The reference is copied (never edited in place) to $PARITY_WORK/ref and its dependencies are
# installed there with bun, once. ~1.1 GB of node_modules: delete $PARITY_WORK/ref when done.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
ref="$PARITY_WORK/ref/cloudflare"
if [ ! -d "$ref" ]; then
  mkdir -p "$PARITY_WORK/ref"
  cp -R "$REF_SRC/cloudflare" "$PARITY_WORK/ref/"
fi
[ -d "$ref/node_modules" ] || (cd "$ref" && bun install --frozen-lockfile)
