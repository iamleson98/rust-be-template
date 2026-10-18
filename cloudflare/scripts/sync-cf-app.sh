#!/bin/bash
# Sync repo/cloudflare (git source of truth) -> /home/z/my-project (runtime copy).
# SAFETY: never --delete at the top level — /home/z/my-project contains repo/
# itself (the source), plus sandbox state (node_modules, .wrangler, dev-data).
# Stale-file cleanup is handled explicitly per-directory where needed.
set -e
SRC=/home/z/my-project/repo/cloudflare
DST=/home/z/my-project

# App source: mirror exactly (delete allowed INSIDE src/, scoped)
rsync -a --delete --exclude='cloudflare-env.d.ts' "$SRC/src"/ "$DST/src"/
# These top-level app dirs are safe to mirror (they exist only for the app):
for d in migrations container public; do
  rsync -a --delete "$SRC/$d"/ "$DST/$d"/
done
# Config files: copy one by one (never delete anything else at top level)
for f in package.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs \
         components.json drizzle.config.ts wrangler.jsonc open-next.config.ts custom-worker.ts \
         README-CLOUDFLARE.md; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$DST/$f"
done
echo "synced repo/cloudflare -> /home/z/my-project (safe mode)"
