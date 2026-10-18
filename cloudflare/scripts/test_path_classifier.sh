#!/usr/bin/env bash
# Unit test for the ci.yml `changes` job classification logic.
# Mirrors the exact regexes from .github/workflows/ci.yml and feeds it
# realistic changed-file lists, asserting the expected stack selection.
set -uo pipefail

backend_rx='(^|/)(Cargo\.toml|Cargo\.lock|deny\.toml|taplo\.toml|rust-toolchain[^/]*|\.rustfmt\.toml|clippy\.toml)$|^\.cargo/|^rust-sql$|\.rs$|^frontend/openapi\.json$'
frontend_rx='^frontend/'
mobile_rx='^mobile/'
docker_rx='^(Dockerfile|\.dockerignore)$'
ci_rx='^\.github/'
light_rx='\.md$|^\.markdownlint-cli2\.yaml$|^\.hadolint\.yaml$|^\.gitleaksignore$|^LICENSE'
classified_rx="${backend_rx}|${frontend_rx}|${mobile_rx}|${docker_rx}|${ci_rx}|${light_rx}"

classify() {
  local files="$1"
  local backend=false frontend=false mobile=false docker=false run_all=false
  if printf '%s\n' "$files" | grep -Eq "$backend_rx";  then backend=true;  fi
  if printf '%s\n' "$files" | grep -E "$frontend_rx" | grep -Evq '\.md$'; then frontend=true; fi
  if printf '%s\n' "$files" | grep -E "$mobile_rx"   | grep -Evq '\.md$'; then mobile=true;   fi
  if printf '%s\n' "$files" | grep -Eq "$docker_rx";   then docker=true;   fi
  if printf '%s\n' "$files" | grep -Eq "$ci_rx";       then run_all=true;  fi
  if printf '%s\n' "$files" | grep -Evq "$classified_rx"; then run_all=true; fi
  echo "$backend $frontend $mobile $docker $run_all"
}

pass=0; fail=0
check() {
  local name="$1" files="$2" expected="$3"
  local got; got=$(classify "$files")
  if [ "$got" = "$expected" ]; then
    pass=$((pass+1)); echo "PASS  $name"
  else
    fail=$((fail+1)); echo "FAIL  $name"
    echo "      files:    $(echo "$files" | tr '\n' ' ')"
    echo "      expected: $expected"
    echo "      got:      $got"
  fi
}

# 1. backend-only: Rust sources + manifests
check "backend-only (.rs + Cargo)" \
"src/ws/hub.rs
Cargo.toml
Cargo.lock
migrator/src/migration/m20261002_000016_add_query_indexes.rs
store_macros/src/lib.rs" \
"true false false false false"

# 2. backend configs + toolchain
check "backend configs (.cargo/deny/taplo/rustfmt/clippy)" \
".cargo/audit.toml
deny.toml
taplo.toml
.rustfmt.toml
clippy.toml
rust-toolchain.toml" \
"true false false false false"

# 3. submodule pin bump (like PR #44)
check "submodule bump only" \
"rust-sql" \
"true false false false false"

# 4. frontend-only
check "frontend-only" \
"frontend/src/App.tsx
frontend/bun.lock
frontend/src/lib/api/sdk.gen.ts" \
"false true false false false"

# 5. mobile-only
check "mobile-only" \
"mobile/lib/features/call/call_signaling.dart
mobile/pubspec.yaml
mobile/android/app/build.gradle.kts" \
"false false true false false"

# 6. backend API change with spec regen (openapi.json + SDK both committed)
check "backend API change + regen (coupled gates)" \
"src/routes/system.rs
frontend/openapi.json
frontend/src/lib/api/sdk.gen.ts" \
"true true false false false"

# 7. docs-only PR (incl. .md files living inside stack dirs)
check "docs-only PR" \
"docs/CI.md
README.md
deploy/DB-SIZE-RUNBOOK.md
mobile/README.md
frontend/README.md
mobile/assets/sounds/ATTRIBUTION.md" \
"false false false false false"

# 8. hygiene configs
check "hygiene config files" \
".markdownlint-cli2.yaml
.hadolint.yaml
.gitleaksignore" \
"false false false false false"

# 9. docker files
check "docker-only" \
"Dockerfile
.dockerignore" \
"false false false true false"

# 10. unknown files → run_all (fail-safe)
check "unknown Makefile → run_all" \
"Makefile" \
"false false false false true"

check "unknown .env.example → run_all" \
".env.example" \
"false false false false true"

check "unknown scripts/ + deploy/ → run_all" \
"scripts/export_db_schema.py
deploy/stack.yml" \
"false false false false true"

check "unknown terraform → run_all" \
"terraform/main.tf" \
"false false false false true"

check "unknown nullclaw.config.json → run_all" \
"nullclaw.config.json" \
"false false false false true"

# 11. CI definition change → run_all
check ".github change → run_all" \
".github/workflows/ci.yml" \
"false false false false true"

# 12. mixed backend + mobile
check "mixed backend + mobile" \
"src/server.rs
mobile/lib/main.dart" \
"true false true false false"

# 13. deleted-file edge: deleted frontend file still counts
check "deleted frontend file" \
"frontend/src/routes/dead.tsx" \
"false true false false false"

# 14. empty diff (degenerate PR) → fail-safe run_all (empty line classifies as unknown)
check "empty diff → fail-safe" \
"" \
"false false false false true"

# 15. tests/ integration rust + k6 js
check "tests (rs + k6)" \
"tests/api_smoke.rs
tests/k6/config.js" \
"true false false false true"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
