# Deployment Guide — VeXeVN (Rust + React)

This guide covers deploying the full stack (Rust backend + React frontend) to a **Kamatera** VM in **Asia-Singapore** with full CI/CD via GitHub Actions.

## Architecture

```
                    ┌─────────────────────────────────┐
                    │  GitHub Actions (CI/CD)        │
                    │                                 │
  git push ────────►│  1. cargo check + clippy       │
                    │  2. tsc --noEmit + vite build   │
                    │  3. docker build + push to GHCR │
                    │  4. SSH deploy to VM            │
                    └──────────┬──────────────────────┘
                               │
                    ┌──────────▼──────────────────────┐
                    │  Kamatera VM (Singapore)        │
                    │  Ubuntu 22.04                    │
                    │                                 │
                    │  ┌───────────────────────────┐  │
                    │  │  Docker Container         │  │
                    │  │                           │  │
                    │  │  Caddy (:80/:443)        │  │
                    │  │    └── TLS (Let's Encrypt)│  │
                    │  │    └── reverse_proxy      │  │
                    │  │         └── :8080          │  │
                    │  │                           │  │
                    │  │  Backend (Rust/Axum :8080) │  │
                    │  │    ├── REST API (/api/*)  │  │
                    │  │    ├── WebSocket (/ws)    │  │
                    │  │    ├── Static (frontend)   │  │
                    │  │    └── SQLite (app.db)    │  │
                    │  │                           │  │
                    │  └───────────────────────────┘  │
                    └─────────────────────────────────┘
```

## CI/CD Pipeline

### Continuous Integration (`.github/workflows/ci.yml`)

Runs on every push/PR to `server` or `main`:

1. **Backend (Rust)**: `cargo check` + `cargo clippy --tests` (zero warnings enforced via `-D warnings`)
2. **Frontend (React)**: `npm install` + `tsc --noEmit` + `vite build`

Both run in parallel on separate runners. Cargo cache is shared across runs.

### Continuous Deployment (`.github/workflows/deploy.yml`)

Triggers on push to `server` branch (after CI passes):

1. **Build** — multi-stage Docker image (frontend + backend) pushed to GitHub Container Registry (`ghcr.io/iamleson98/vexevn:latest`)
2. **Deploy** — SSH into Kamatera VM, `docker compose pull` + `docker compose up -d`, health check

**Required GitHub repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Description |
|---|---|
| `VM_HOST` | Kamatera VM public IP or domain |
| `VM_SSH_KEY` | SSH private key for root access (PEM format) |
| `VM_USER` | SSH username (usually `root`) |

The `GITHUB_TOKEN` is auto-provided for GHCR authentication — no secret needed.

The Docker image is multi-stage:
1. **Stage 1** — builds the React frontend (`vite build` → `dist/`)
2. **Stage 2** — compiles the Rust backend (`cargo build --release`)
3. **Stage 3** — slim runtime with the binary + frontend dist

The backend serves both the API (`/api/*`, `/ws`) and the frontend static files via `tower-http::ServeDir`.

---

## Prerequisites

### 1. Kamatera account

Sign up at [kamatera.com](https://www.kamatera.com). Get your API credentials from the console:
- **API Token** — Settings → API → API Key
- **API Secret** — shown once when you generate the key

### 2. SSH key pair

```bash
# Generate if you don't have one:
ssh-keygen -t ed25519 -C "your-email@example.com"
# Your public key will be at ~/.ssh/id_ed25519.pub
```

### 3. Install Terraform + rsync

```bash
# macOS:
brew install terraform rsync

# Ubuntu/Debian:
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install terraform rsync
```

### 4. Kamatera Terraform provider

The Kamatera provider is available on the Terraform Registry:
```bash
cd terraform/
terraform init
```

---

## Step-by-Step Deployment

### Step 1: Configure Terraform

```bash
cd terraform/

# Create your terraform.tfvars (from the example):
cp terraform.tfvars.example terraform.tfvars

# Edit and fill in your Kamatera API credentials:
nano terraform.tfvars
```

Contents of `terraform.tfvars`:
```hcl
kamatera_api_token  = "your-api-token-here"
kamatera_api_secret = "your-api-secret-here"
```

### Step 2: Provision the VM

```bash
cd terraform/

# Review the plan:
terraform plan

# Create the VM:
terraform apply
```

This provisions an Ubuntu 22.04 VM in Kamatera's Singapore datacenter with:
- **2 vCPU, 2GB RAM** (AMD — ~$12/month, configurable in `main.tf`)
- **30GB SSD**
- Your SSH public key installed for root access

The output will show the VM's public IP:
```
vm_public_ip = "xx.xx.xx.xx"
ssh_command  = "ssh root@xx.xx.xx.xx"
app_url      = "http://xx.xx.xx.xx:8080"
```

### Step 3: Deploy the application

From the repo root (NOT the terraform/ directory):

```bash
# Make the deploy script executable:
chmod +x terraform/deploy.sh

# Run it with the VM's IP:
./terraform/deploy.sh $(terraform -chdir=terraform output -raw vm_public_ip)
```

The deploy script will:
1. **SSH into the VM** and install Docker + Docker Compose
2. **rsync** the repo to `/opt/vexevn/` on the VM
3. **Generate a production `.env`** with a random JWT secret
4. **Build the Docker image** (multi-stage: frontend + backend — takes ~10-20 minutes)
5. **Start the container** via `docker compose -f docker-compose.prod.yml up -d`
6. **Wait for the health check** to confirm the app is running

### Step 4: Verify

```bash
# Check the health endpoint:
curl http://<VM_IP>:8080/health

# Open the app in your browser:
open http://<VM_IP>:8080

# View Swagger UI:
open http://<VM_IP>:8080/swagger-ui
```

---

## Set up CI/CD (automatic deploys)

After the first manual deploy, set up GitHub Actions for automatic deploys:

### 1. Add repository secrets

Go to GitHub → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `VM_HOST` | Your VM's public IP (e.g. `139.180.123.45`) |
| `VM_SSH_KEY` | Contents of your SSH private key file (e.g. `~/.ssh/id_ed25519`) |
| `VM_USER` | `root` (or whatever user you created on the VM) |

### 2. Push to `server` branch

Every push to `server` now triggers:
1. CI: `cargo check` + `clippy` + `tsc --noEmit` + `vite build` (parallel)
2. CD: Docker build → push to GHCR → SSH deploy to VM → health check

You'll see deploy status in the GitHub Actions tab. The deploy job takes ~15-20 minutes (mostly the Rust build inside Docker).

### 3. Auto-deploy on push

From now on, just:
```bash
git push origin server
```
The CI/CD pipeline handles everything. You can monitor progress at:
```
https://github.com/iamleson98/rust-be-template/actions
```

---

## Post-Deployment Configuration

### Change the JWT secret

The deploy script auto-generates a random JWT secret. To change it:

```bash
ssh root@<VM_IP>
cd /opt/vexevn
# Generate a new secret:
NEW_SECRET=$(openssl rand -hex 32)
sed -i "s|^JWT__SECRET=.*|JWT__SECRET=${NEW_SECRET}|g" .env
# Restart:
docker compose -f docker-compose.prod.yml restart
```

### Configure for a custom domain

1. Point your domain's A record to the VM's public IP.
2. Update `.env` on the VM:

```bash
ssh root@<VM_IP>
cd /opt/vexevn
nano .env
```

Change:
```env
COOKIE__DOMAIN=yourdomain.com
COOKIE__SECURE=true
CORS__ORIGINS=https://yourdomain.com
```

3. For HTTPS, add a reverse proxy (Caddy or Nginx):

```bash
# Install Caddy:
apt install -y caddy

# Configure /etc/caddy/Caddyfile:
cat > /etc/caddy/Caddyfile << 'EOF'
yourdomain.com {
    reverse_proxy localhost:8080
}
EOF

systemctl restart caddy
```

Caddy will automatically provision a Let's Encrypt TLS certificate.

### Update the app after code changes

```bash
# From your local machine:
./terraform/deploy.sh <VM_IP>

# Or manually:
rsync -avz --delete \
    --exclude='.git' --exclude='target/' --exclude='frontend/node_modules/' \
    --exclude='osm-index/' --exclude='*.db' --exclude='storage/' \
    -e ssh ./ root@<VM_IP>:/opt/vexevn/

ssh root@<VM_IP> 'cd /opt/vexevn && docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d'
```

---

## Managing the deployment

All commands run via SSH on the VM:

```bash
ssh root@<VM_IP>
cd /opt/vexevn
```

| Action | Command |
|---|---|
| View logs | `docker compose -f docker-compose.prod.yml logs -f` |
| Restart | `docker compose -f docker-compose.prod.yml restart` |
| Stop | `docker compose -f docker-compose.prod.yml down` |
| Start | `docker compose -f docker-compose.prod.yml up -d` |
| Rebuild | `docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d` |
| Check health | `curl localhost:8080/health` |
| Check DB size | `ls -lh app.db` |
| Check disk space | `df -h` |
| Check container status | `docker ps` |

---

## Backup

### SQLite database backup

```bash
ssh root@<VM_IP> 'cd /opt/vexevn && cp app.db app.db.bak.$(date +%Y%m%d)'
```

Or download locally:
```bash
scp root@<VM_IP>:/opt/vexevn/app.db ./backup-$(date +%Y%m%d).db
```

---

## Destroy (tear down)

```bash
cd terraform/
terraform destroy
```

This deletes the VM and all data on it. Make sure you have a backup of `app.db` first.

---

## Cost estimate

| Component | Cost |
|---|---|
| Kamatera VM (2 vCPU, 2GB RAM, 30GB SSD, Singapore) | ~$12/month |
| Bandwidth (1TB included) | $0 (included) |
| **Total** | **~$12/month** |

For higher traffic, upgrade the VM size in `terraform/main.tf`:
- `A4aa` (4 vCPU, 4GB) — ~$24/month
- `B2aa` (2 vCPU, 4GB Intel) — ~$20/month

---

## Troubleshooting

### Container won't start

```bash
ssh root@<VM_IP>
cd /opt/vexevn
docker compose -f docker-compose.prod.yml logs
```

Common issues:
- **Port 8080 in use**: `lsof -i :8080` — kill the conflicting process
- **Database locked**: `rm app.db && docker compose -f docker-compose.prod.yml restart` (destroys data!)
- **Out of memory**: Upgrade VM size or reduce `DATABASE__MAX_CONNECTIONS`

### Build fails

The Docker build compiles Rust from source — this needs ~2GB RAM. On a 1GB VM:
```bash
# Use swap:
ssh root@<VM_IP> 'fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile'
```

### OSM place search not working

The Tantivy index is not included in the Docker image (too large). To enable place search:

```bash
ssh root@<VM_IP>
cd /opt/vexevn
# Download OSM PBF:
mkdir -p data && cd data
wget https://download.geofabrik.de/asia/vietnam-latest.osm.pbf
# Build the index:
cd /opt/vexevn
docker compose -f docker-compose.prod.yml exec backend import-osm --pbf data/vietnam-latest.osm.pbf --index-dir osm-index
# Restart to pick up the index:
docker compose -f docker-compose.prod.yml restart
```

### Rate limit (429)

Default is 600 RPM (10 req/sec) with burst 100. To increase:

```bash
ssh root@<VM_IP>
cd /opt/vexevn
sed -i 's/^RATE_LIMIT__RPM=.*/RATE_LIMIT__RPM=1200/' .env
sed -i 's/^RATE_LIMIT__BURST=.*/RATE_LIMIT__BURST=200/' .env
docker compose -f docker-compose.prod.yml restart
```
