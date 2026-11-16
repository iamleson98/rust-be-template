#!/usr/bin/env bash
# Prepare the OVH VPS (Ubuntu, shared with the k3s agent and the quiz pod) to
# run datxevui under systemd. Run as root from a checkout (or a copy) of this
# directory; every step is safe to repeat:
#
#   sudo bash deploy/vps/bootstrap.sh
#   sudoedit /etc/datxevui/env        # secrets: see env.example
#   sudo datxevui-update auto         # first install; it enables the timers
#
# It does NOT start the service (there is no binary yet), enable a timer
# (the first `datxevui-update` does that once the env file is filled in),
# or change SSH or k3s settings. Firewall: SSH only, as before; datxevui
# listens on 127.0.0.1 and cloudflared connects outwards.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
for f in datxevui.service datxevui-backup.service \
  datxevui-backup.timer datxevui-update.service datxevui-update.timer backup.sh update.sh env.example; do
  [ -f "$here/$f" ] || { echo "$here/$f is missing: run this from a full copy of deploy/vps" >&2; exit 1; }
done
export DEBIAN_FRONTEND=noninteractive

echo "== memory"
mem_mb="$(awk '/^MemTotal:/ {print int($2 / 1024)}' /proc/meminfo)"
free -m
if [ "$mem_mb" -lt 3500 ]; then
  echo "WARNING: ${mem_mb} MB of RAM. The limits in datxevui.service assume 4 GB; lower MemoryHigh/MemoryMax first." >&2
fi
# The weekly place build runs inside datxevui.service's cgroup and peaks near 665 MB (debug build, macOS; see docs/CUTOVER.md): swap absorbs it instead of the OOM killer.
if [ -z "$(swapon --show --noheadings)" ]; then
  echo "no swap: creating /swapfile (1 GiB)"
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness = 10' > /etc/sysctl.d/99-datxevui.conf
sysctl --system >/dev/null

echo "== packages"
timedatectl set-timezone Asia/Ho_Chi_Minh
apt-get update -y
# sqlite3: the backup's VACUUM INTO and a shell on the database. rclone:
# backup uploads. jq and curl: datxevui-update.
apt-get install -y --no-install-recommends ca-certificates curl jq sqlite3 rclone ufw

echo "== firewall"
ufw default deny incoming
ufw default allow outgoing
ufw limit OpenSSH
ufw --force enable
# Rules the k3s agent needs (10250/tcp, 8472/udp) are left alone; anything
# that opens the web ports would expose the origin that Cloudflare hides.
if ufw status | grep -E '(^|[^0-9])(80|443|8080)(/(tcp|udp))?[[:space:]]' | grep -qi allow; then
  echo "WARNING: ufw allows 80, 443 or 8080 from outside; datxevui needs none of them." >&2
fi

echo "== user and directories"
id datxevui >/dev/null 2>&1 || \
  useradd --system --home-dir /var/lib/datxevui --no-create-home --shell /usr/sbin/nologin datxevui
install -d -m 0755 -o datxevui -g datxevui /var/lib/datxevui
install -d -m 0755 -o datxevui -g datxevui /var/lib/datxevui/uploads /var/lib/datxevui/places
install -d -m 0700 -o datxevui -g datxevui /var/lib/datxevui/backups
install -d -m 0755 /opt/datxevui/releases /etc/datxevui
if [ ! -f /etc/datxevui/env ]; then
  install -m 0640 -o root -g datxevui "$here/env.example" /etc/datxevui/env
  echo "wrote /etc/datxevui/env: fill in JWT_SECRET and the rest before the first install"
fi

echo "== units and scripts"
for u in datxevui.service datxevui-backup.service \
  datxevui-backup.timer datxevui-update.service datxevui-update.timer; do
  install -m 0644 "$here/$u" "/etc/systemd/system/$u"
done
install -m 0755 "$here/backup.sh" /usr/local/sbin/datxevui-backup
install -m 0755 "$here/update.sh" /usr/local/sbin/datxevui-update
systemctl daemon-reload

echo "== checks"
if ! systemctl is-active --quiet datxevui && ss -ltnH 'sport = :8080' | grep -q .; then
  echo "port 8080 is already taken by another process:" >&2
  ss -ltnpH 'sport = :8080' >&2
  echo "free it, or set SERVER_PORT in /etc/datxevui/env and the tunnel's service URL" >&2
  exit 1
fi
if ! command -v cloudflared >/dev/null; then
  echo "WARNING: cloudflared is not installed; install it and route the hostnames (cloudflared-ingress.yml)" >&2
fi
echo "== bootstrap done"
