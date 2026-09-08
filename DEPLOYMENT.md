# Deployment

Current production deployment is documented in [deploy/README.md](deploy/README.md).

## Supported Files

- [deploy/stack.yml](deploy/stack.yml) is the current production stack for `datxevui.com`. The GitHub deploy workflow syncs this file with [deploy/deploy.sh](deploy/deploy.sh) and [deploy/Caddyfile.datxevui](deploy/Caddyfile.datxevui).
- [deploy/docker-compose.contabo.yml](deploy/docker-compose.contabo.yml) is the standalone single-VPS compose path for a fresh Contabo/Cloudflare Tunnel setup.
- [tests/k6/docker-compose.k6.yml](tests/k6/docker-compose.k6.yml) is only for distributed k6 load testing.

The old root-level Docker Compose files were removed to avoid maintaining multiple production paths.

## Production Defaults

For the current single-node production setup:

```dotenv
CACHE_BACKEND=moka
WORKER_BACKEND=db
```

Redis is not required for production right now. Reintroduce Redis only when you need a shared cache or Redis-backed worker queue across multiple app instances.

## Release

Production releases are tag-driven:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The deploy workflow builds the single Docker image, pushes it to GHCR, syncs the deployment files, runs [deploy/deploy.sh](deploy/deploy.sh), and checks `/health`.
