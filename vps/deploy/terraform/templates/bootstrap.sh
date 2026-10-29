#!/bin/bash
# Prepares the vps-service host. OpenTofu uploads and runs it over SSH;
# every step is safe to repeat.
set -euo pipefail
exec > >(tee -a /var/log/datxevui-bootstrap.log) 2>&1
export DEBIAN_FRONTEND=noninteractive
echo "== $(date -Is) datxevui bootstrap"

hostnamectl set-hostname "${NAME:-datxevui-vps}"
timedatectl set-timezone Asia/Ho_Chi_Minh

apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl ufw unattended-upgrades jq
dpkg-reconfigure -f noninteractive unattended-upgrades

# Firewall: SSH only. The service listens on 127.0.0.1 and Cloudflare
# Tunnel connects outwards, so nothing else is opened.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

# Key-only SSH. sshd keeps the first value it reads, so this file must sort
# before cloud-init's 50-cloud-init.conf.
cat > /etc/ssh/sshd_config.d/01-datxevui.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSHD
systemctl reload ssh || systemctl reload sshd

# The journal keeps the service's logs; cap it on a 40 GB disk.
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/99-datxevui.conf <<'JOURNALD'
[Journal]
SystemMaxUse=500M
JOURNALD
systemctl restart systemd-journald

# A little swap absorbs the weekly index run's peak instead of the OOM killer.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness = 10' > /etc/sysctl.d/99-datxevui.conf
sysctl --system >/dev/null

# cloudflared (the tunnel itself is wired by hand: it needs your Cloudflare login).
if ! command -v cloudflared >/dev/null; then
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(. /etc/os-release && echo "$VERSION_CODENAME") main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -y
  apt-get install -y cloudflared
fi

# CI deploy user (release.yml): key login, and sudo for exactly one command,
# the release updater (vps/deploy/update.sh installed as root-owned
# /usr/local/sbin/vps-service-update; it accepts a release name only).
if [ -n "${DEPLOY_KEY:-}" ]; then
  id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
  install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
  echo "$DEPLOY_KEY" > /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys
  chmod 0600 /home/deploy/.ssh/authorized_keys
  echo 'deploy ALL=(root) NOPASSWD: /usr/local/sbin/vps-service-update *' > /etc/sudoers.d/90-datxevui-deploy
  chmod 0440 /etc/sudoers.d/90-datxevui-deploy
  visudo -cf /etc/sudoers.d/90-datxevui-deploy
fi
if [ ! -x /usr/local/sbin/vps-service-update ]; then
  curl -fsSL -o /usr/local/sbin/vps-service-update \
    "https://raw.githubusercontent.com/iamleson98/rust-be-template/HEAD/vps/deploy/update.sh" \
    && chmod 0755 /usr/local/sbin/vps-service-update \
    || echo "update.sh not on the default branch yet (PR #111): installed by the first deploy"
fi

# vps-service, once its release exists (published when PR #111 merges).
repo=iamleson98/rust-be-template
if curl -fsI -o /dev/null "https://github.com/$repo/releases/download/vps-service/vps-service-x86_64-linux.tar.gz" 2>/dev/null; then
  /usr/local/sbin/vps-service-update
else
  echo "vps-service release not published yet: run vps/deploy/update.sh after it is"
fi

echo "== bootstrap done"
