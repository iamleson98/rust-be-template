# Deployment Setup Checklist

> **Status**: ✅ All deployment code has been fixed and verified.

Follow these steps to deploy your application to Kamatera.

## Prerequisites

### 1. Generate SSH Keys (if you don't have them)

```bash
ssh-keygen -t ed25519 -C "deploy@vexevn" -f ~/.ssh/id_ed25519
# This creates: ~/.ssh/id_ed25519 (private) and ~/.ssh/id_ed25519.pub (public)
```

### 2. Kamatera Account & API Credentials

1. Sign up at [kamatera.com](https://kamatera.com)
2. Go to Console → Settings → API
3. Generate an API key and note:
   - **API Token** (keep secret)
   - **API Secret** (keep secret)

### 3. Domain & DNS

1. Register or have access to a domain (e.g., `api.example.com`)
2. You'll update the DNS A record after the VM is created

---

## Step 1: Set Up GitHub Secrets

Your GitHub repository needs **3 secrets** for the CD pipeline to work.

**How to add secrets**:
1. Go to GitHub → Your Repository → Settings → Secrets and variables → Actions
2. Click "New repository secret" for each:

| Secret | Value | Example |
|--------|-------|---------|
| `VM_HOST` | Your Kamatera VM's public IP (set after Step 2) | `203.0.113.42` |
| `VM_SSH_KEY` | Contents of `~/.ssh/id_ed25519` (private key) | `-----BEGIN PRIVATE KEY-----...` |
| `VM_USER` | SSH username | `root` |

> ⚠️ **NEVER commit secrets to Git.** Keep them in GitHub Secrets only.

---

## Step 2: Provision the VM with Terraform

### Initialize Terraform

```bash
cd terraform/
terraform init
```

### Plan the Deployment

```bash
export KAMATERA_API_TOKEN="your-api-token"
export KAMATERA_API_SECRET="your-api-secret"

terraform plan
```

Review the output. You should see it will create:
- SSH key
- Ubuntu 22.04 VM (2 vCPU, 2GB RAM, 30GB SSD)
- Automatically install Docker & Docker Compose

### Apply the Deployment

```bash
terraform apply
```

This takes ~5-15 minutes. Once complete, you'll see:

```
Outputs:

app_url = "http://203.0.113.42:8080"
ssh_command = "ssh root@203.0.113.42"
swagger_url = "http://203.0.113.42:8080/swagger-ui"
vm_public_ip = "203.0.113.42"
```

**Copy the VM IP address** — you'll need it next.

### Verify VM is Ready

```bash
ssh root@<vm_public_ip>
docker --version
docker compose version
exit
```

If both commands print versions, ✅ Docker is installed.

---

## Step 3: Update GitHub Secrets

Now that you have the VM IP, add it to GitHub:

1. Go to GitHub → Settings → Secrets and variables → Actions
2. Update `VM_HOST` = `<vm_public_ip>` (from Terraform output)
3. Add `VM_SSH_KEY` = contents of your **private** SSH key (~/.ssh/id_ed25519)
4. Add `VM_USER` = `root`

---

## Step 4: Set Up Your Domain

1. Go to your domain registrar (GoDaddy, Namecheap, Route53, etc.)
2. Create an **A record** pointing to your VM's public IP:
   - Domain: `yourdomain.com` or `api.yourdomain.com`
   - Type: `A`
   - Value: `<vm_public_ip>`
   - TTL: 300 (or default)

3. Wait 5-10 minutes for DNS to propagate:
   ```bash
   nslookup yourdomain.com
   # Should return your <vm_public_ip>
   ```

---

## Step 5: Update Caddyfile (HTTPS Configuration)

Edit [Caddyfile](Caddyfile) in the repo root:

**Before** (❌ template):
```
yourdomain.com {
    reverse_proxy localhost:8080
```

**After** (✅ your domain):
```
api.example.com {
    reverse_proxy localhost:8080
```

> Caddy will automatically provision a **Let's Encrypt SSL certificate** when the domain is live.

---

## Step 6: Deploy via GitHub Actions

### First Deployment (Manual)

Push your code to the `server` branch to trigger the CI/CD pipeline:

```bash
git add .
git commit -m "deploy: fix terraform and github actions"
git push origin server
```

Then:
1. Go to GitHub → Your Repository → Actions
2. Watch the `CI` workflow (test backend & frontend)
3. After CI passes, the `Deploy` workflow will:
   - Build the Docker image
   - Push to GitHub Container Registry (GHCR)
   - SSH into the VM
   - Pull the image and run `docker compose up -d`

### Monitor the Deployment

```bash
# SSH into the VM
ssh root@<vm_public_ip>

# Watch the deployment
cd /opt/vexevn
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend

# Check the app is running
curl http://localhost:8080/health
```

---

## Step 7: Test the Deployment

Once deployed:

### Health Check via curl
```bash
curl http://yourdomain.com:8080/health
# Should return: {"status":"ok"}
```

### API (with Caddy HTTPS)
```bash
curl https://yourdomain.com/api/health
# Should return: {"status":"ok"}
```

### Swagger UI
```
https://yourdomain.com/swagger-ui
```

### Database Check (SQLite)
```bash
ssh root@<vm_public_ip>
docker compose -f /opt/vexevn/docker-compose.prod.yml exec backend ls -lh /app/data/app.db
```

---

## Troubleshooting

### ❌ Deployment Failed

Check the GitHub Actions logs:
1. Go to GitHub → Actions → Failed workflow
2. Click "Deploy to Kamatera" job
3. See the error in "Deploy and verify" step

Common issues:
- **"Cannot connect to VM"** → Check `VM_HOST` and `VM_SSH_KEY` secrets
- **"docker: command not found"** → SSH into VM and check Docker installed: `docker --version`
- **"Health check failed"** → SSH into VM and check logs: `docker compose logs -f backend`

### ❌ Health Check Fails

SSH into the VM and debug:
```bash
ssh root@<vm_public_ip>
cd /opt/vexevn

# Check container is running
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs --tail 100 backend

# Check the app can respond
curl http://localhost:8080/health

# Check .env is set correctly
cat .env | grep JWT__SECRET
```

### ❌ HTTPS Certificate Not Working

1. Verify DNS is set up:
   ```bash
   nslookup yourdomain.com
   # Should return your VM IP
   ```

2. Caddy needs to see the domain on first boot. If you added it after deployment, restart Caddy:
   ```bash
   ssh root@<vm_public_ip>
   docker compose -f /opt/vexevn/docker-compose.prod.yml restart caddy
   ```

3. Check Caddy logs:
   ```bash
   docker compose -f /opt/vexevn/docker-compose.prod.yml logs caddy
   ```

---

## Future Deployments

After the first deployment, **just push to `server` branch**:

```bash
git push origin server
```

The GitHub Actions workflow will:
1. ✅ Run CI (cargo check, clippy, tsc, npm build)
2. ✅ Build & push Docker image to GHCR
3. ✅ Deploy to your Kamatera VM
4. ✅ Run health checks

**No manual steps needed!**

---

## Scaling & Production Tips

| Need | Solution |
|------|----------|
| **Multiple instances** | Add load balancer + autoscaling via Terraform |
| **Postgres instead of SQLite** | Uncomment `db:` service in `docker-compose.prod.yml`; build with `--build-arg BACKEND_FEATURES=postgres` |
| **Redis caching** | Uncomment `redis:` service in `docker-compose.prod.yml` |
| **Monitoring & logs** | Add ELK stack or use Kamatera monitoring console |
| **Automated backups** | Add `pg_dump` cron job for database backups |
| **Custom domain + Caddy** | Already set up in `Caddyfile` — just update domain name |

---

## Security Checklist

- [ ] Change `JWT__SECRET` to a strong random value (generated in `.env` during deploy)
- [ ] Set `COOKIE__SECURE=true` in `.env` (only allow HTTPS cookies)
- [ ] Update `CORS__ORIGINS` to your domain (not `*` in production)
- [ ] Enable SSH key-only auth (disable password login on VM)
- [ ] Use a firewall to restrict inbound ports (only allow 22, 80, 443)
- [ ] Regularly update Docker images (`docker pull` in GitHub Actions)
- [ ] Monitor logs for errors: `docker compose logs backend`

---

**Questions?** Check [DEPLOYMENT.md](DEPLOYMENT.md) for architecture details or ask in the repo issues.
