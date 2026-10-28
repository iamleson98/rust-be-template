# datxevui

Bus-ticket booking for Vietnam, live at <https://datxevui.com>. The whole
product runs on Cloudflare's free plan: one Next.js app on Workers with D1
(SQLite), R2, KV and two Durable Objects for realtime chat and calls.

| Path | What it is |
| ---- | ---------- |
| [`cloudflare/`](cloudflare/README-CLOUDFLARE.md) | The web app and API (Next.js 16 + OpenNext on Workers) |
| [`mobile/`](mobile/README.md) | Flutter support app for staff (chat, calls, push) |
| [`tools/place-extract/`](tools/place-extract) | Rust tool that turns the OSM Vietnam extract into the static place-search index |
| [`docs/`](docs) | Product rules: pricing, seat layouts, campaigns, iOS calls, security policy |

## Working on the web app

```bash
cd cloudflare
bun install
bun run dev          # Next.js dev server with local D1/R2 bindings
bun run test         # workerd tests against real D1/R2/KV bindings (Miniflare)
bun run typecheck
```

Deploy, migrations, cron and the free-plan limits are described in
[`cloudflare/README-CLOUDFLARE.md`](cloudflare/README-CLOUDFLARE.md) and
[`cloudflare/docs/FREE-TIER.md`](cloudflare/docs/FREE-TIER.md).

## CI

| Workflow | Runs |
| -------- | ---- |
| `cloudflare.yml` | typecheck, lint, format and tests on every pull request |
| `cloudflare-deploy.yml` | tests, D1 migrations, deploy and a health check on the default branch |
| `place-index.yml` | weekly: builds the place-search index and redeploys |
| `mobile.yml` | format, analyze, test and a debug APK build when `mobile/` changes |
| `codeql.yml` | CodeQL on the TypeScript code |

## History

The original Rust (axum + rustqlite) backend and Vite SPA were removed after
the Cloudflare port reached parity. They remain in git history at commit
`2d41c84` and earlier; `cloudflare/docs/PARITY-AND-EDGE-AUDIT.md` records how
each route and rule was checked against them.
