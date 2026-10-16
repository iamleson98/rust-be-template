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
```

Redis is not required for production right now. Reintroduce Redis only when you need a shared cache or Redis-backed worker queue across multiple app instances.

## Real client IP / rate limiting

The rate limiter (`tower_governor`), the WS per-IP caps and the audio-call
geo gate all key on the IP derived in `src/middleware/client_ip.rs`:
right-anchored `X-Forwarded-For` with `TRUSTED_PROXY_HOPS=1` (default —
exactly the one append Caddy makes), falling back to `CF-Connecting-IP`.
Two config points must stay true together:

1. `deploy/Caddyfile.datxevui` lists `trusted_proxies` for Caddy's docker
   peer (`172.16.0.0/12`). Without it Caddy REPLACES the
   `X-Forwarded-For` Cloudflare built with its own gateway IP — every
   visitor collapses into ONE shared ~100 rps bucket (load test
   2026-10-15; `RATE_LIMIT_RPM=6000` ⇒ 10 ms refill ⇒ ~100 rps sustained).
2. The backend tolerates the degraded shape as a second line of defense:
   a private/loopback XFF entry defers to `CF-Connecting-IP`, so CF-proxied
   traffic still keys per real visitor even if (1) regresses.

The published port 8443 is loopback-only (DOCKER-USER drop), so the only
thing that can reach Caddy's `:443` listener is the nginx SNI router —
trusting the private range vouches for nginx and nothing else.

## Release

Production releases are tag-driven:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The deploy workflow builds the single Docker image, pushes it to GHCR, syncs the deployment files, runs [deploy/deploy.sh](deploy/deploy.sh), and checks `/health`.
