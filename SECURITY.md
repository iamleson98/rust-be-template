# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please **DO NOT** open a public
GitHub issue. Instead, email **security@vexevn.vn** with:

1. A description of the issue and its impact
2. Steps to reproduce (or a proof of concept)
3. Your assessment of severity (Critical / High / Medium / Low)

We will acknowledge receipt within 48 hours and aim to ship a fix within
7 days for High/Critical issues, 30 days for Medium/Low.

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` (latest `server` branch) | ✅ |
| Older releases                   | ❌ |

## Security Posture

This codebase follows defense-in-depth:

- **Auth**: Argon2id (OWASP-recommended memory-hard KDF) for password hashing;
  HS256 JWT (≥32-byte secret) with `iss`/`exp`/`typ` validation;
  opaque rotating refresh tokens with HMAC'd storage and family invalidation;
  HttpOnly + Secure + SameSite=Lax cookies; double-submit CSRF tokens
  with constant-time comparison on every mutating request.
- **Authorization**: cached RBAC (`rbac.require(user_id, "perm")`) before
  every mutating service method; per-row ownership checks on every
  BOLA-sensitive read/write (`booking.user_id == caller_id`).
- **Payments**: HMAC-SHA256 signature verification on every VNPay/MoMo/ZaloPay
  IPN callback using `constant_time_eq`; callback-amount vs DB-amount
  tampering check; idempotency on terminal state transitions; COD
  explicitly bypasses the gateway but still goes through the booking
  state machine.
- **Transport**: TLS via Caddy (auto Let's Encrypt), HSTS preload,
  strict CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Resilience**: per-IP rate limiting (token bucket, 600 RPM default),
  per-route tighter limits on auth endpoints, per-request timeout (30s),
  per-request body size limit (2 MB), bounded WS channels + idle timeout.
- **Storage**: path-traversal protection in `LocalStorage` (component-based
  normalization + `..` rejection), MIME sniffing, content-type allowlist.
- **WS**: Origin header check on every upgrade (rejects CSWSH),
  per-IP connection cap (10), global cap (50k), heartbeat + idle timeout.
- **Secrets**: never committed. `.env.example` contains only placeholder
  strings; `.env` is gitignored. In production, secrets are injected via
  the runtime environment (e.g. Docker Compose `env_file`, K8s secrets,
  AWS SSM Parameter Store, Doppler, etc.).

## Pre-Deployment Checklist

Before exposing any instance to the public internet, verify:

- [ ] `JWT_SECRET` is regenerated via `cargo run -- key generate` (≥32 bytes)
- [ ] `JWT_SECRET` is at least 32 bytes long (the bootstrap validator fails
      fast otherwise, but please verify manually)
- [ ] `COOKIE_SECURE=true` (so cookies are HTTPS-only)
- [ ] `CORS_ORIGINS` lists ONLY your real frontend origins (never `*`)
- [ ] `OAUTH_GOOGLE_CLIENT_SECRET` and any other OAuth secrets are rotated
      if they were ever committed (audit `git log -p .env.example`)
- [ ] Payment HMAC secrets (VNPay/MoMo/ZaloPay) are obtained from the
      respective provider dashboards
- [ ] Caddyfile `yourdomain.com` is replaced with your real domain
- [ ] `terraform/` state is stored remotely (S3 + DynamoDB lock) — see
      `terraform/main.tf`
- [ ] Docker images run as non-root user (the included `Dockerfile`
      creates and switches to a non-root user)
- [ ] Database backups are configured (rust-sql: copy `app.db` off the
      data volume on a cron + push to S3 — see DEPLOYMENT.md §14)
- [ ] Log aggregation ships `tracing` JSON to your SIEM (Datadog, Loki, etc.)

## Incident Response

If a secret is leaked (committed to git, exposed in logs, etc.):

1. **Rotate immediately** — generate a new secret and deploy.
2. **Revoke existing sessions** — call `backend`'s revocation endpoint
   or set `user_revoked_at = NOW()` for affected users.
3. **Scrub git history** — `git filter-repo --path .env.example --invert-paths`
   (note: GitHub keeps cached commits forever; rotation is the only real fix).
4. **Audit access** — check provider audit logs (Google Cloud, payment
   gateways) for abuse during the leak window.
5. **Post-mortem** — add a regression test that fails the build if any
   secret-looking string (`ghp_`, `gho_`, `GOCSPX-`, `sk_live_`, 64-hex
   JWT secrets, etc.) appears in committed files. See
   `.github/workflows/ci.yml → secrets-scan` job.
