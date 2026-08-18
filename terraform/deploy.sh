# ─── deploy.sh — Post-Terraform server provisioning ────────────────
#
# This script runs after `terraform apply` provisions the VM.
# It installs Docker, clones the repo, builds the image, and starts
# the app.
#
# Usage:
#   terraform apply
#   ./deploy.sh <vm_public_ip>
#
# Or run it locally and push to the VM:
#   ssh root@<ip> 'bash -s' < deploy.sh

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

# ─── 3. Build and start with Docker Compose ─────────────────────────

echo "==> Building and starting Docker containers..."

ssh $SSH_OPTS root@$VM_IP 'bash -s' << 'REMOTE'
set -euo pipefail
cd /opt/vexevn

# Generate a production JWT secret if not already set.
if [ ! -f .env ]; then
    echo "=== Creating .env from .env.example ==="
    cp .env.example .env
    # Generate a random 32-byte JWT secret.
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s|^JWT__SECRET=.*|JWT__SECRET=${JWT_SECRET}|g" .env
    # Set cookie secure=true for production.
    sed -i 's|^COOKIE__SECURE=.*|COOKIE__SECURE=false|g' .env
    # Allow all origins (or set to your domain).
    sed -i 's|^CORS__ORIGINS=.*|CORS__ORIGINS=*|g' .env
    echo "=== .env created with random JWT secret ==="
fi

echo "=== Building Docker image (this may take 10-20 minutes) ==="
docker compose -f docker-compose.prod.yml build

echo "=== Starting containers ==="
docker compose -f docker-compose.prod.yml up -d

echo "=== Waiting for health check ==="
sleep 10
if curl -sf http://localhost:8080/health; then
    echo ""
    echo "✅ App is healthy and running on port 8080"
else
    echo "⚠️  Health check failed — check logs:"
    echo "   docker compose -f docker-compose.prod.yml logs"
fi

echo ""
echo "=== Deployment complete ==="
echo "App:  http://$(curl -s ifconfig.me):8080"
echo "Swagger: http://$(curl -s ifconfig.me):8080/swagger-ui"
echo ""
echo "Logs: docker compose -f /opt/vexevn/docker-compose.prod.yml logs -f"
echo "Stop: docker compose -f /opt/vexevn/docker-compose.prod.yml down"

REMOTE

echo "==> Deployment complete."
