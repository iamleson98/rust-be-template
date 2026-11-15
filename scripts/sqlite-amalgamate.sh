#!/usr/bin/env bash
# sqlite-amalgamate.sh — build the SQLite amalgamation from SQLite's
# `begin-concurrent` branch and install it into the vendored
# libsqlite3-sys crate (vendor/libsqlite3-sys).
#
# The backend runs on real C SQLite in plain WAL mode and relies on
# `BEGIN CONCURRENT` (page-level optimistic write concurrency), which
# only exists on that branch — no release amalgamation has it.
#
# The default branch is `begin-concurrent-3.51`: begin-concurrent rebased
# onto the 3.51 release line, whose tip carries a release version stamp
# ("Version 3.51.x for the begin-concurrent branch"). Do NOT pin the
# `begin-concurrent` trunk branch for production: it tracks SQLite trunk
# (pre-release code, no stable-branch fixes). Set SQLITE_BRANCH to move
# the pin to another begin-concurrent-* branch.
#
# Usage:
#   ./scripts/sqlite-amalgamate.sh <commit-sha>
#
#   <commit-sha>  a commit on the begin-concurrent-3.51 branch of
#                 https://github.com/sqlite/sqlite (the full 40-char sha;
#                 current pin: see vendor/libsqlite3-sys/PINNED)
#
# Environment:
#   SQLITE_BRANCH   branch the commit must be on (default:
#                   begin-concurrent-3.51).
#   SQLITE_SRC_DIR  where to keep the sqlite clone (default: a fresh
#                   temp dir). Reused when it already holds a clone.
#
# Needs: git, make and a C compiler. The SQLite build bootstraps its own
# Tcl interpreter (jimsh), so no tclsh is required. In a clean container:
#   docker run --rm -v "$PWD":/w -w /w debian:bookworm-slim sh -c \
#     'apt-get update -qq && apt-get install -y -qq git make gcc ca-certificates && \
#      ./scripts/sqlite-amalgamate.sh <commit-sha>'
#
# Writes vendor/libsqlite3-sys/sqlite3/{sqlite3.c,sqlite3.h,sqlite3ext.h}
# and vendor/libsqlite3-sys/PINNED (commit sha, SQLite source id,
# version). Commit all of them together; a Rust test compares
# sqlite3_sourceid() of the linked library against PINNED.
set -euo pipefail

SQLITE_REPO="https://github.com/sqlite/sqlite"
SQLITE_BRANCH="${SQLITE_BRANCH:-begin-concurrent-3.51}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/../vendor/libsqlite3-sys"

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <40-char commit sha on the $SQLITE_BRANCH branch>" >&2
  exit 2
fi
SHA="$1"

SRC_DIR="${SQLITE_SRC_DIR:-$(mktemp -d)}"
if [[ ! -d "$SRC_DIR/.git" ]]; then
  git clone --quiet --branch "$SQLITE_BRANCH" "$SQLITE_REPO" "$SRC_DIR"
fi
cd "$SRC_DIR"
git fetch --quiet origin "$SQLITE_BRANCH"
if ! git merge-base --is-ancestor "$SHA" "origin/$SQLITE_BRANCH"; then
  echo "error: $SHA is not on the $SQLITE_BRANCH branch" >&2
  exit 1
fi
git checkout --quiet --force "$SHA"
git clean --quiet -fdx

./configure >/dev/null
make sqlite3.c >/dev/null

# SQLITE_SOURCE_ID is the Fossil check-in hash + timestamp, not the git sha.
SOURCE_ID="$(sed -n 's/^#define SQLITE_SOURCE_ID *"\(.*\)"$/\1/p' sqlite3.h)"
VERSION="$(sed -n 's/^#define SQLITE_VERSION *"\(.*\)"$/\1/p' sqlite3.h)"
if [[ -z $SOURCE_ID || -z $VERSION ]]; then
  echo "error: could not read the source id / version from sqlite3.h" >&2
  exit 1
fi

mkdir -p "$VENDOR_DIR/sqlite3"
cp sqlite3.c sqlite3.h sqlite3ext.h "$VENDOR_DIR/sqlite3/"
cat >"$VENDOR_DIR/PINNED" <<PINNED
git_sha=$SHA
source_id=$SOURCE_ID
version=$VERSION
PINNED

echo "pinned SQLite $VERSION ($SOURCE_ID) from $SHA"
