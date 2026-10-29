#!/usr/bin/env bash
# Install or update vps-service from the rolling `vps-service` GitHub release
# (published by .github/workflows/vps.yml). Run as root on the VPS:
#
#   sudo bash update.sh            # latest build
#
# First run: creates the service user, /etc/vps-service (config + env
# template) and the systemd unit. Later runs: verify the download's SHA-256,
# swap the binary, restart, and roll back if /healthz does not come up.
set -euo pipefail

repo="${VPS_REPO:-iamleson98/rust-be-template}"
base="https://github.com/$repo/releases/download/vps-service"
asset="vps-service-x86_64-linux.tar.gz"
bin=/usr/local/bin/vps-service
etc=/etc/vps-service

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl -fsSL --retry 3 -o "$work/$asset" "$base/$asset"
curl -fsSL --retry 3 -o "$work/$asset.sha256" "$base/$asset.sha256"
(cd "$work" && sha256sum -c "$asset.sha256")
tar -xzf "$work/$asset" -C "$work"
new="$work/vps-service"

# First install: user, config, env template, unit.
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
    echo "VPS_SERVICE_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
    echo "CRON_SERVICE_TOKEN=change-me-to-the-workers-CRON_SERVICE_TOKEN"
  } > "$etc/env"
  chown root:vps-service "$etc/env"
  chmod 0640 "$etc/env"
  echo "wrote $etc/env: set CRON_SERVICE_TOKEN, and give VPS_SERVICE_TOKEN to the Worker"
fi
install -m 0644 "$new/deploy/vps-service.service" /etc/systemd/system/vps-service.service
systemctl daemon-reload

# Swap the binary, keeping the old one for a rollback.
[ -f "$bin" ] && cp -p "$bin" "$bin.previous"
install -m 0755 "$new/vps-service" "$bin.new"
mv -f "$bin.new" "$bin"
systemctl enable vps-service >/dev/null
systemctl restart vps-service

# /healthz is 503 until an index is live: on a first install the initial
# OSM run takes a few minutes, so only "the process answers" is checked.
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/healthz || true)
  if [ "$code" = 200 ] || [ "$code" = 503 ]; then
    echo "vps-service is up (healthz $code): $($bin --version)"
    exit 0
  fi
  sleep 1
done

echo "vps-service did not come up" >&2
journalctl -u vps-service -n 40 --no-pager >&2 || true
if [ -f "$bin.previous" ]; then
  echo "rolling back to the previous binary" >&2
  mv -f "$bin.previous" "$bin"
  systemctl restart vps-service
fi
exit 1
