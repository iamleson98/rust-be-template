#!/usr/bin/env bash
# Install or update vps-service from a signed GitHub release. Run as root:
#
#   vps-service-update auto        # the newest vX.Y.Z release, if not installed yet (the timer)
#   vps-service-update v1.2.0      # that release
#   vps-service-update vps-service # the rolling build of the default branch
#
# Nothing reaches the VPS from outside to deploy: the vps-service-update
# timer runs `auto` every 5 minutes. A release is installed only when its
# tarball matches the published SHA-256 AND carries a valid signature by the
# release key pinned below (CI signs with RELEASE_SIGNING_KEY), so a
# tampered or substituted download is refused.
#
# Each run also installs itself as /usr/local/sbin/vps-service-update and
# the timer units; the first run creates the service user, config, env file
# and unit. A release that fails to start is rolled back and not retried.
set -euo pipefail

repo="${VPS_REPO:-iamleson98/rust-be-template}"
asset="vps-service-x86_64-linux.tar.gz"
bin=/usr/local/bin/vps-service
etc=/etc/vps-service
state=/var/lib/vps-service-update
# The only key whose signatures are accepted (ssh-keygen -Y; ~/.ssh/datxevui-release.pub).
signer='datxevui-release namespaces="vps-service-release" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKP2Bn6hh1LRPML4QBkVk5M7BzNZ3SLfR8/KR7YS8IR2'

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
install -d -m 0700 "$state"

release="${1:-auto}"
auto=false
if [ "$release" = auto ]; then
  auto=true
  # The newest published vX.Y.Z (the rolling `vps-service` build is a prerelease).
  release=$(curl -fsSL -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$repo/releases/latest" | jq -r '.tag_name // empty') || release=""
  [ -n "$release" ] || { echo "no release found"; exit 0; }
  if [ "$release" = "$(cat "$state/installed" 2>/dev/null)" ] || [ "$release" = "$(cat "$state/failed" 2>/dev/null)" ]; then
    exit 0
  fi
fi
if ! [[ "$release" =~ ^(vps-service|v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?)$ ]]; then
  echo "not a release name: $release" >&2
  exit 2
fi
base="https://github.com/$repo/releases/download/$release"
echo "installing vps-service $release"

work="$(mktemp -d)"
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
ssh-keygen -Y verify -f "$work/allowed_signers" -I datxevui-release -n vps-service-release \
  -s "$work/$asset.sig" < "$work/$asset"
tar -xzf "$work/$asset" -C "$work"
new="$work/vps-service"

# First install: user, config, env file.
if ! id vps-service >/dev/null 2>&1; then
  useradd --system --home /var/lib/vps-service --shell /usr/sbin/nologin vps-service
fi
install -d -m 0755 "$etc"
if [ ! -f "$etc/config.toml" ]; then
  install -m 0644 "$new/config.example.toml" "$etc/config.toml"
  echo "wrote $etc/config.toml (review it)"
fi
if [ ! -f "$etc/env" ]; then
  umask 077
  {
    echo "VPS_SERVICE_TOKEN=$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)"
    echo "CRON_SERVICE_TOKEN=change-me-to-the-workers-CRON_SERVICE_TOKEN"
  } > "$etc/env"
  chown root:vps-service "$etc/env"
  chmod 0640 "$etc/env"
  echo "wrote $etc/env: set CRON_SERVICE_TOKEN, and give VPS_SERVICE_TOKEN to the Worker"
fi
for unit in vps-service.service vps-service-update.service vps-service-update.timer; do
  install -m 0644 "$new/deploy/$unit" "/etc/systemd/system/$unit"
done
install -m 0755 "$new/deploy/update.sh" /usr/local/sbin/vps-service-update
systemctl daemon-reload
systemctl enable --now vps-service-update.timer >/dev/null

# Swap the binary, keeping the old one for a rollback.
if [ -f "$bin" ]; then cp -p "$bin" "$bin.previous"; fi
install -m 0755 "$new/vps-service" "$bin.new"
mv -f "$bin.new" "$bin"
systemctl enable vps-service >/dev/null
systemctl restart vps-service

# /healthz is 503 until an index is live: on a first install the initial
# OSM run takes a few minutes, so only "the process answers" is checked.
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/healthz || true)
  if [ "$code" = 200 ] || [ "$code" = 503 ]; then
    echo "$release" > "$state/installed"
    rm -f "$state/failed"
    echo "vps-service $release is up (healthz $code): $($bin --version)"
    exit 0
  fi
  sleep 1
done

echo "vps-service $release did not come up" >&2
echo "$release" > "$state/failed"
journalctl -u vps-service -n 40 --no-pager >&2 || true
if [ -f "$bin.previous" ]; then
  echo "rolling back to the previous binary" >&2
  mv -f "$bin.previous" "$bin"
  systemctl restart vps-service
fi
exit 1
