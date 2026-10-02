# CI — the quality harness

Every push to `master`/`server`/`main` and every PR targeting them runs
the full gate matrix in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
plus semantic security analysis in [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml).
Releases are tag-driven (`v*` → `deploy.yml`); master pushes never deploy.

`master` is branch-protected: **all jobs below are required checks** — a
red job blocks the merge. Rename a job in ci.yml ⇒ update the required
checks list in repo Settings → Branches (job `name:` values must match
exactly).

## The matrix

| Stack | Gate | Tool | Fix recipe |
|---|---|---|---|
| Backend | Format | `cargo fmt --check` | `make fmt-rust` |
| Backend | Compile | `cargo check --all-targets` | read the error 🙂 |
| Backend | Lint | `cargo clippy -D warnings` | `make lint-rust` |
| Backend | Tests + doctests | `cargo test --all-targets` / `--doc` | `make test-rust` |
| Backend | Doc links | `cargo doc` with `RUSTDOCFLAGS=-D warnings` | fix the flagged `[std::x]` link |
| Backend | API contract | OpenAPI drift gate (below) | regen + commit |
| Backend | CVEs | `cargo audit --deny warnings` (`.cargo/audit.toml` = documented ignores) | upgrade the crate |
| Backend | Dep policy | `cargo-deny` advisories/licenses/sources (`deny.toml`) | upgrade, or allow-list a *permissive* license |
| Backend | Unused deps | `cargo-machete` (ours only; FP list in `[package.metadata.cargo-machete]`) | remove the dep from Cargo.toml |
| Backend | TOML format | `taplo fmt --check` (`taplo.toml`) | `make fmt-toml` |
| Frontend | Format | `prettier --check .` (`.prettierrc`, `.prettierignore`) | `make fmt-web` |
| Frontend | Lint | `eslint --max-warnings 0 .` (whole tree incl. e2e + configs) | `make lint-web` |
| Frontend | Types | `tsc --noEmit` (src + e2e + configs) | fix the flagged line |
| Frontend | SDK freshness | regen `src/lib/api` + diff (below) | `cd frontend && bun run openapi` |
| Frontend | Dead code / unused deps | `knip --include files,dependencies` (`knip.json`) | delete the file / remove the dep |
| Frontend | Unit tests | `vitest run` (225) | `make test-web` |
| Frontend | Build | `vite build` + prerender | fix the build error |
| Frontend | E2E | Playwright chromium suite (79 specs, no backend needed) | `cd frontend && bun run test:e2e` |
| Mobile | Format | `dart format --set-exit-if-changed .` | `make fmt-mobile` |
| Mobile | Analyze | `flutter analyze --fatal-infos` (zero issues incl. infos) | fix the diagnostic |
| Mobile | Tests | `flutter test` | `make test-mobile` |
| Mobile | Build | `flutter build apk --debug` (Gradle/AGP smoke) | fix the build |
| Repo | Workflows | `actionlint` | fix the flagged expression |
| Repo | Shell | `shellcheck -S warning` on every tracked `*.sh` | fix, or `# shellcheck disable=SCXXXX` with a reason |
| Repo | Dockerfile | `hadolint` (`.hadolint.yaml` = documented ignores) | fix the instruction |
| Repo | Markdown | `markdownlint-cli2` (`.markdownlint-cli2.yaml`) | add `--fix` to the command |
| Repo | JSON | parse `openapi.json`, `manifest.webmanifest`, tsconfigs… | fix the JSON |
| Repo | Secrets | gitleaks (full history) + known-leaked-pattern grep | rotate the secret, scrub |
| Repo | Image | `docker build` end-to-end smoke | fix the Dockerfile |
| Security | Semantics | CodeQL `rust` + `javascript-typescript` (weekly re-scan too) | fix the query finding |

## The two drift gates (how the API contract stays honest)

1. **OpenAPI spec drift** (backend job): a test,
   `dump_openapi_spec_for_the_frontend_sdk`, rewrites
   `frontend/openapi.json` from the backend's compiled-in utoipa spec
   every time `cargo test` runs. The gate diffs the working tree
   afterwards — if the committed file differs, the backend API changed
   without regenerating the contract. Fix:

   ```sh
   cargo test --lib dump_openapi_spec_for_the_frontend_sdk
   cd frontend && bun run openapi     # regenerate the TS SDK
   git add ../frontend/openapi.json src/lib/api && git commit
   ```

2. **OpenAPI SDK freshness** (frontend job): regenerates `src/lib/api`
   from the committed `openapi.json` and diffs — catches "spec was
   regenerated but the SDK wasn't". Fix: `cd frontend && bun run openapi`.

## Running it all locally (fast feedback loop)

```sh
make ci         # fmt-check + every lint + all unit tests + tsc + knip
make lint       # just the linters
make fmt        # auto-fix formatting (rust, toml, web, mobile)
make test       # backend + frontend + mobile unit tests
```

Standalone binaries needed for the non-cargo linters (`taplo`,
`shellcheck`, `hadolint`, `actionlint`, `cargo-deny`, `cargo-machete`)
default to `~/.local/bin` — override with `make LINT_BIN=…`. Download
links for every pinned version live in the "Install pinned lint
binaries" steps of ci.yml.

## Design rules

- **Every job is independent** — a mobile regression never hides a Rust
  clippy warning behind a 40-minute queue.
- **Pinned tool versions in CI** — lint binaries are downloaded from
  fixed release URLs, not `latest`, so a tool release can't flip CI red
  overnight. Bump deliberately, together with the URL.
- **Documented exceptions only** — advisory ignores (`.cargo/audit.toml`
  + `deny.toml`), hadolint ignores (`.hadolint.yaml`), machete
  false-positives (`[package.metadata.cargo-machete]`) all carry the
  *reason* and the *revisit condition* inline.
- **The engine rides master** — every backend job updates the rust-sql
  submodule to upstream `master` before building, so engine regressions
  surface in CI, not in production. Findings inside `rust-sql/` are
  upstream's (machete filters that block).
- **Superseded runs are cancelled** — `concurrency` groups keep the
  queue short; only the latest push per ref runs to completion.
- **Branch protection makes it binding** — required checks + linear
  history (rebase merges). Emergency direct pushes by admins are
  disabled; use a PR (fast-forward via rebase keeps the history clean).

## Known deliberate gaps

- **Backend test coverage %** is not threshold-gated (coverage tooling
  for this workspace is heavy; revisit if the suite thins out).
- **Admin E2E** (`frontend/e2e-admin/`, real backend + seeded DB) runs
  locally only (`bun run test:e2e:admin`) — it needs the debug binary +
  demo seed; wiring it into CI would duplicate the whole Rust build.
- **`--features kafka`** (rdkafka/librdkafka) is not CI-compiled — needs
  system librdkafka; compile it manually when touching `src/worker/kafka.rs`.
- **CodeQL** runs the default security-extended suites; findings land in
  the Security tab, not as PR annotations for info-level results.
