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
apt-get install -y --no-install-recommends ca-certificates curl ufw unattended-upgrades jq sshguard
dpkg-reconfigure -f noninteractive unattended-upgrades

# Firewall: SSH only. The service listens on 127.0.0.1 and Cloudflare
# Tunnel connects outwards, so nothing else is opened.
ufw default deny incoming
ufw default allow outgoing
ufw delete allow OpenSSH >/dev/null 2>&1 || true
# Rate-limited: an address opening 6+ connections in 30 s is dropped.
ufw limit OpenSSH
ufw --force enable

# SSH: keys only, one user, few tries, no forwarding but local ports (for
# `ssh -L 8787:127.0.0.1:8787`). sshd keeps the first value it reads, so
# this file must sort before cloud-init's 50-cloud-init.conf. sshguard bans
# addresses that keep failing. Break-glass: the OVHcloud KVM console.
cat > /etc/ssh/sshd_config.d/01-datxevui.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
AllowUsers ubuntu
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding local
PermitTunnel no
SSHD
sshd -t
systemctl reload ssh || systemctl reload sshd
systemctl enable --now sshguard

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

# No inbound deploys: the vps-service-update timer pulls signed releases.
# (An earlier version had a CI `deploy` user; make sure it is gone.)
if id deploy >/dev/null 2>&1; then userdel --remove deploy 2>/dev/null || true; fi
rm -f /etc/sudoers.d/90-datxevui-deploy

# vps-service: the first install fetches the updater, which then installs
# the newest signed release and its own 5-minute timer.
if [ ! -x /usr/local/sbin/vps-service-update ]; then
  curl -fsSL -o /usr/local/sbin/vps-service-update \
    "https://raw.githubusercontent.com/iamleson98/rust-be-template/HEAD/vps/deploy/update.sh"
  chmod 0755 /usr/local/sbin/vps-service-update
fi
/usr/local/sbin/vps-service-update auto

echo "== bootstrap done"
