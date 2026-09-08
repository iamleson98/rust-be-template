# ─── deploy.sh — deprecated Terraform provisioning helper ───────────
#
# Deployment is now documented in deploy/README.md and uses the files in
# deploy/. The old root docker-compose files were removed to avoid keeping
# multiple production paths alive.

echo "This Terraform helper is deprecated. Use deploy/README.md and deploy/deploy.sh instead." >&2
exit 1

set -euo pipefail

VM_IP="${1:?Usage: deploy.sh <vm_public_ip>}"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

echo "==> Deploying to ${VM_IP}..."

# ─── 1. Install Docker + Docker Compose ─────────────────────────────

ssh $SSH_OPTS root@$VM_IP 'bash -s' << 'REMOTE'
set -euo pipefail

echo "=== Installing Docker ==="
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
    echo "Docker installed."
else
    echo "Docker already installed."
fi

echo "=== Installing Docker Compose v2 (plugin) ==="
if ! docker compose version &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq docker-compose-plugin
fi
echo "Docker Compose version:"
docker compose version

REMOTE

echo "==> Docker installed on VM."

# ─── 2. Clone/update the repo + copy .env ────────────────────────────

echo "==> Copying application code to VM..."

# Copy the entire repo to the VM (excluding target/, node_modules, .git)
ssh $SSH_OPTS root@$VM_IP 'mkdir -p /opt/vexevn'

rsync -avz --delete \
    --exclude='.git' \
    --exclude='target/' \
    --exclude='frontend/node_modules/' \
    --exclude='osm-index/' \
    --exclude='*.db' \
    --exclude='*.db-shm' \
    --exclude='*.db-wal' \
    --exclude='storage/' \
    --exclude='data/' \
    -e "ssh $SSH_OPTS" \
    ./ root@$VM_IP:/opt/vexevn/

echo "==> Code copied."

