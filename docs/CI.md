# CI — the quality harness

PRs targeting `master` run the full gate matrix in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) plus semantic
security analysis in [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml).
**Nothing re-runs after a merge** — see "Trigger design" below for why
that is safe. Releases are tag-driven (`v*` → `deploy.yml`); master
pushes never deploy.

`master` is branch-protected: **all jobs below are required checks** — a
red job blocks the merge. Rename a job in ci.yml ⇒ update the required
checks list in repo Settings → Branches (job `name:` values must match
exactly).

## Trigger design — verify once, at the door

The repo only accepts PRs into `master` (enforced: admins included,
linear history, no force-push). The guarantee chain that makes
post-merge re-runs unnecessary:

1. `pull_request` events run against the **merge ref**
   (`refs/pull/N/merge` = PR rebased onto the *current* master tip) —
   CI validates the exact tree a merge would produce, not the branch
   tip in isolation.
2. Branch protection is **strict** (`Require branches to be up to date
   before merging`): if master moves after the checks pass, the PR is
   blocked until updated *and re-verified*.
3. ⇒ The tree the PR checks validated **is** the tree that lands. A
   `push`-triggered run on master afterwards validates nothing new —
   it was pure duplicate cost (the CI + CodeQL duplicate runs this
   design eliminated).

| Trigger | CI (`ci.yml`) | CodeQL | Purpose |
|---|---|---|---|
| `pull_request` → master | ✔ | ✔ | **The binding gate** (merge-ref tree) |
| `merge_group` | ✔ | ✔ | Merge-queue-ready; no-op until a queue is enabled |
| `schedule` | Mon 03:00 UTC | Mon 04:30 UTC | Drift canary (see below) |
| `workflow_dispatch` | ✔ | — | Manual full-matrix escape hatch |
| `push` → master | ✘ removed | ✘ removed | Was the duplicate post-merge run |
| `push` → tag `v*` | — (deploy.yml) | — | CD: build once, deploy once, no test duplication |

**Why not a merge queue?** A queue would guarantee the same property by
re-running the required checks on the queued batch before landing it —
that is a *second* full matrix run per PR, the opposite of "save time".
With one maintainer merging PRs sequentially, strict up-to-date already
delivers the guarantee; the workflows carry `merge_group` triggers, so
enabling a queue later (Settings → Branches → Require merge queue) is a
zero-code-change toggle for when concurrent merges become routine.

**The weekly canary is drift detection, not re-verification.** Backend
jobs build against *upstream* rust-sql master ("the engine rides
master") and CVE advisories accumulate over time. Without a `push`
trigger, a quiet week would leave that drift invisible. The Monday
03:00 UTC scheduled run exercises the full matrix on current master —
engine regressions and fresh advisories surface within 7 days. Note:
GitHub auto-disables scheduled workflows after 60 days of repo
inactivity (any push re-enables); this repo merges far more often.

### Path filtering (what runs on a given PR)

The `changes` job classifies the diff (merge-base → merge ref) and each
stack job runs only when its files changed. Skipped jobs report
conclusion `skipped`, which branch protection counts as success
(GitHub-documented: required checks need `successful`, `skipped`, or
`neutral`) — so the required-check contract keeps working.

**`docker-build` never runs on PRs** (any path filter outcome): the
smoke build dominates PR wall-clock time, cargo already gates the
backend code, and `deploy.yml` builds the identical tree when a tag
ships. It remains part of the matrix for `schedule`, `merge_group`,
and `workflow_dispatch` runs, where it keeps catching Dockerfile /
engine-build drift that cargo cannot see.

| Changed files | Jobs that run |
|---|---|
| `**/*.rs`, `Cargo.toml`/`lock`, `rust-sql` (submodule pin), `.cargo/`, `deny.toml`, `taplo.toml`, `frontend/openapi.json` | backend, backend-audit, backend-quality, docker-build (non-PR events only) |
| `frontend/**` (non-markdown) | frontend, frontend-e2e, docker-build (non-PR events only) |
| `mobile/**` (non-markdown) | mobile |
| `Dockerfile`, `.dockerignore` | docker-build (non-PR events only) |
| `.github/**` | **everything** (CI integrity) |
| `*.md` (anywhere — incl. stack-dir READMEs), `.markdownlint-cli2.yaml`, `.hadolint.yaml`, `.gitleaksignore`, `LICENSE` | repo-hygiene + secrets-scan only (they always run) |
| anything else (Makefile, `scripts/`, `deploy/`, `terraform/`, configs…) | **everything** — fail-safe |
| schedule / dispatch | **everything** |

Fail-safe rules, in order of precedence:

- **Unknown ⇒ expensive.** Any file that matches no known class runs the
  full matrix — a mis-classified change must never skip a gate.
- **`changes` is itself a required check.** If the classifier fails, its
  dependents report `skipped` (which passes protection) — but the red
  `Changes (path filter)` check blocks the merge. Fail-closed: a broken
  filter cannot silently disarm the harness.
- **repo-hygiene and secrets-scan always run.** They are cheap, whole-tree
  gates — a secret can hide in any file, not just code.
- **docker-build follows backend + frontend** — the image ships both — but
  only on non-PR events (see the note above the table).

`frontend/openapi.json` counts as a backend file: the OpenAPI drift and
SDK-freshness gates (below) stay coupled when the backend API surface
changes.

## The matrix

| Stack | Gate | Tool | Fix recipe |
|---|---|---|---|
| Backend | Format | `cargo fmt -p backend -p store_macros -p migrator -- --check` (workspace members only — the rust-sql submodule is NOT our style responsibility) | `make fmt-rust` |
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
| Repo | Image | `docker build` end-to-end smoke — schedule/merge_group/dispatch only, never on PRs | fix the Dockerfile |
| Security | Semantics | CodeQL `rust` + `javascript-typescript` (weekly re-scan too) | fix the query finding |
| Classifier | Paths | `changes` job — diff → per-stack booleans (fail-safe) | fix the regex / add the class |

The matrix table above lists gates per stack; which of them RUN on a
given PR is decided by the path filter (see "Path filtering").

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
- **Verify once, at the door** — CI gates the PR's merge-ref tree;
  nothing re-runs on master after the merge (strict up-to-date
  protection makes the PR verdict cover the landed tree). See
  "Trigger design" above for the full rationale.
- **Branch protection makes it binding** — required checks (incl. the
  `Changes (path filter)` classifier) + linear history (rebase merges).
  Emergency direct pushes by admins are disabled; use a PR
  (fast-forward via rebase keeps the history clean). Pre-PR feedback on
  a feature branch = open a draft PR — it triggers the same matrix.

## Known deliberate gaps

- **Backend test coverage %** is not threshold-gated (coverage tooling
  for this workspace is heavy; revisit if the suite thins out).
- **Admin E2E** (`frontend/e2e-admin/`, real backend + seeded DB) runs
  locally only (`bun run test:e2e:admin`) — it needs the debug binary +
  demo seed; wiring it into CI would duplicate the whole Rust build.
- **`--features kafka`** (rdkafka/librdkafka) is not CI-compiled — needs
  system librdkafka; compile it manually when touching `src/worker/kafka.rs`.
- **CodeQL** runs the default security-extended suites; findings land in
  the Security tab, not as PR annotations for info-level results. The
  default-branch analysis baseline refreshes weekly (Monday 04:30 UTC
  schedule) instead of on every merge — PR gates still prevent new
  unanalyzed code from landing.
- **Engine drift between CI and deploy** — deploys always build with the
  *newest* upstream rust-sql master (deliberate; see deploy.yml's
  "RELEASES ALWAYS SHIP THE NEWEST ENGINE" note), so the shipped engine
  may be newer than what the merged PR's CI run exercised. The weekly
  canary bounds that exposure to 7 days.
