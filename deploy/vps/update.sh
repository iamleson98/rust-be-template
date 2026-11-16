#!/usr/bin/env bash
# Install or update datxevui from a signed GitHub release. Run as root:
#
#   datxevui-update auto      # the newest vX.Y.Z release, if not installed yet (the timer)
#   datxevui-update v1.2.0    # that release (also how you roll back by hand)
#
# Nothing reaches the VPS from outside to deploy: datxevui-update.timer runs
# `auto` every 5 minutes. A release is installed only when its tarball
# matches the published SHA-256 AND carries a valid signature by the release
# key pinned below (CI signs with RELEASE_SIGNING_KEY), so a tampered or
# substituted download is refused.
#
# Layout:
#   /opt/datxevui/releases/<tag>/{datxevui,dist/,deploy/,.own-assets}
#   /opt/datxevui/current  -> releases/<tag>   (flipped atomically)
#   /var/lib/datxevui/legacy-next/             (the old Worker's _next/static, persistent)
#
# A swap: verify, back up the database (local snapshot), carry the previous
# release's hashed assets into the new dist/ so open tabs can still lazy-load
# their chunks, flip `current`, restart, and require /ready to answer 200.
# A release that does not come up is rolled back (symlink, units and scripts)
# and not retried. Database migrations run when the new binary starts and are
# not undone: if the old binary refuses a migrated database, restore the
# pre-update snapshot (see backup.sh).
#
# Each run also installs the release's units, backup.sh and this script, so
# they never drift from the binary.
set -euo pipefail

repo="${DATXEVUI_REPO:-iamleson98/rust-be-template}"
asset="datxevui-x86_64-linux.tar.gz"
root=/opt/datxevui
state=/var/lib/datxevui-update
data=/var/lib/datxevui
env_file=/etc/datxevui/env
# The only key whose signatures are accepted (ssh-keygen -Y; the private half
# is the RELEASE_SIGNING_KEY Actions secret). The namespace ties a signature
# to datxevui releases: another project's artefact signed with the same key
# is refused.
signer='datxevui-release namespaces="datxevui-release" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKP2Bn6hh1LRPML4QBkVk5M7BzNZ3SLfR8/KR7YS8IR2'

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
if [ ! -f "$env_file" ] || ! id datxevui >/dev/null 2>&1; then
  echo "run bootstrap.sh first: it creates the datxevui user and $env_file" >&2
  exit 1
fi
install -d -m 0700 "$state"
install -d -m 0755 "$root/releases"

exec 9>"$state/lock"
flock -n 9 || { echo "another datxevui-update is running"; exit 0; }

release="${1:-auto}"
auto=false
if [ "$release" = auto ]; then
  auto=true
  # The newest published vX.Y.Z (the legacy-next holder is a prerelease, which
  # this endpoint never returns).
  release=$(curl -fsSL -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$repo/releases/latest" | jq -r '.tag_name // empty') || release=""
  [ -n "$release" ] || { echo "no release found"; exit 0; }
  if [ "$release" = "$(cat "$state/installed" 2>/dev/null)" ] || [ "$release" = "$(cat "$state/failed" 2>/dev/null)" ]; then
    exit 0
  fi
fi
if ! [[ "$release" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "not a release name: $release" >&2
  exit 2
fi
target="$root/releases/$release"
previous="$(readlink -f "$root/current" 2>/dev/null || true)"
if [ "$previous" = "$target" ]; then
  echo "$release is already the active release"
  exit 0
fi

base="https://github.com/$repo/releases/download/$release"
echo "installing datxevui $release"

work="$(mktemp -d "$root/.work.XXXXXX")"
trap 'rm -rf "$work"' EXIT
for f in "$asset" "$asset.sha256" "$asset.sig"; do
  if ! curl -fsSL --retry 3 -o "$work/$f" "$base/$f"; then
    # A release whose assets are still uploading: try again on the next tick.
    echo "$release: $f is not downloadable (yet)" >&2
    $auto && exit 0
    exit 1
  fi
done
(cd "$work" && sha256sum -c "$asset.sha256")
printf '%s\n' "$signer" > "$work/allowed_signers"
ssh-keygen -Y verify -f "$work/allowed_signers" -I datxevui-release -n datxevui-release \
  -s "$work/$asset.sig" < "$work/$asset"

tar -xzf "$work/$asset" -C "$work" --no-same-owner
new="$work/datxevui"
for f in datxevui dist/index.html deploy/datxevui.service deploy/update.sh deploy/backup.sh; do
  [ -e "$new/$f" ] || { echo "$release is missing $f: refusing to install" >&2; echo "$release" > "$state/failed"; exit 1; }
done
chown -R root:root "$new"
chmod 0755 "$new/datxevui"

# Remember which hashed assets this release ships itself, then add the
# previous release's own ones: a tab opened before the swap still asks for
# the old chunk names. Only one generation is carried, so this never grows.
(cd "$new/dist" && { find assets -type f 2>/dev/null || true; } | sort) > "$new/.own-assets"
if [ -f "$previous/.own-assets" ]; then
  while IFS= read -r f; do
    if [ -f "$previous/dist/$f" ] && [ ! -e "$new/dist/$f" ]; then
      mkdir -p "$new/dist/$(dirname "$f")"
      cp -p "$previous/dist/$f" "$new/dist/$f"
    fi
  done < "$previous/.own-assets"
fi

# The old Worker's /_next/static, shipped in the tarball when CI had it. It
# lives outside the release so it survives updates and rollbacks.
if [ -d "$new/legacy-next" ] && [ -n "$(ls -A "$new/legacy-next")" ]; then
  rm -rf "$data/legacy-next.new" "$data/legacy-next.old"
  cp -a "$new/legacy-next" "$data/legacy-next.new"
  [ ! -d "$data/legacy-next" ] || mv "$data/legacy-next" "$data/legacy-next.old"
  mv "$data/legacy-next.new" "$data/legacy-next"
  rm -rf "$data/legacy-next.old"
fi

# Units, backup.sh and this script from the release at $1. The script itself
# is replaced by rename so the copy running now keeps its inode.
install_deploy() {
  local src="$1/deploy" f
  for f in "$src"/*.service "$src"/*.timer; do
    install -m 0644 "$f" "/etc/systemd/system/$(basename "$f")"
  done
  # The weekly place build is the `places.build` job inside datxevui now; a box
  # installed before that still has the old timer, which would build a second time.
  if [ -e /etc/systemd/system/datxevui-places.timer ]; then
    systemctl disable --now datxevui-places.timer >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/datxevui-places.timer /etc/systemd/system/datxevui-places.service
  fi
  install -m 0755 "$src/backup.sh" /usr/local/sbin/datxevui-backup.new
  mv -f /usr/local/sbin/datxevui-backup.new /usr/local/sbin/datxevui-backup
  install -m 0755 "$src/update.sh" /usr/local/sbin/datxevui-update.new
  mv -f /usr/local/sbin/datxevui-update.new /usr/local/sbin/datxevui-update
  systemctl daemon-reload
}

# A snapshot to go back to if the new binary migrates the database and then
# misbehaves. A failed snapshot stops the update (retried on the next tick).
if [ -f "$data/app.db" ]; then
  echo "snapshotting the database"
  runuser -u datxevui -- /usr/local/sbin/datxevui-backup --local-only
fi

# Publish: the release directory first, then the symlink, so `current` never
# points at a half-copied tree.
rm -rf "$target"
mv "$new" "$target"
ln -sfn "$target" "$root/current.new"
mv -T "$root/current.new" "$root/current"
install_deploy "$target"
systemctl enable datxevui.service datxevui-update.timer datxevui-backup.timer >/dev/null 2>&1
systemctl start datxevui-update.timer datxevui-backup.timer
systemctl restart datxevui

port="$(sed -n 's/^SERVER_PORT=//p' "$env_file" | tail -n1)"
ready="http://127.0.0.1:${port:-8080}/ready"
wait_ready() {
  local _ code
  for _ in $(seq 1 90); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$ready" || true)
    if [ "$code" = 200 ] && systemctl is-active --quiet datxevui; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if wait_ready; then
  echo "$release" > "$state/installed"
  rm -f "$state/failed"
  echo "datxevui $release is up: $("$root/current/datxevui" --version)"
  # Keep the three newest releases (always including the active one and the one before it).
  find "$root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -rn | cut -d' ' -f2- | tail -n +4 \
    | while IFS= read -r old; do
        [ "$old" = "$target" ] || [ "$old" = "$previous" ] || rm -rf "$old"
      done
  exit 0
fi

echo "datxevui $release did not become ready" >&2
echo "$release" > "$state/failed"
journalctl -u datxevui -n 40 --no-pager >&2 || true
if [ -n "$previous" ] && [ -d "$previous" ]; then
  echo "rolling back to $(basename "$previous")" >&2
  ln -sfn "$previous" "$root/current.new"
  mv -T "$root/current.new" "$root/current"
  install_deploy "$previous"
  systemctl restart datxevui
  if wait_ready; then
    echo "the previous release is serving again" >&2
  else
    echo "the previous release did not come up either: restore the latest snapshot in /var/lib/datxevui/backups" >&2
  fi
fi
exit 1
