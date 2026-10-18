#!/usr/bin/env python3
"""Apply branch protection to master requiring every CI + CodeQL check.

Run AFTER the quality-harness PR is merged and green on master:
    GITHUB_TOKEN=ghp_... python3 /home/z/my-project/scripts/protect_master.py

Idempotent: re-running updates the same protection settings.
"""
import json
import os
import sys
import urllib.request

TOKEN = os.environ.get("GITHUB_TOKEN", "")
REPO = "iamleson98/rust-be-template"
BRANCH = "master"

# Must match the job `name:` values in .github/workflows/ci.yml and
# .github/workflows/codeql.yml EXACTLY (see docs/CI.md).
REQUIRED_CHECKS = [
    # Fail-closed classifier: if the path filter itself fails, this check
    # goes red and blocks the merge (its dependents would skip — and
    # "skipped" counts as success for protection, so THIS entry is what
    # keeps a broken filter from silently disarming the gates).
    "Changes (path filter)",
    "Backend (Rust)",
    "Backend - Dependency audit (cargo-audit)",
    "Backend - quality (deny / machete / taplo)",
    "Frontend (React/TS)",
    "Frontend - E2E (Playwright)",
    "Mobile (Flutter)",
    "Repo hygiene (shell / docker / markdown / json)",
    "Secrets scan (gitleaks)",
    "Docker image build (smoke)",
    "Analyze (rust)",
    "Analyze (javascript-typescript)",
]

PAYLOAD = {
    "required_status_checks": {
        "strict": True,  # head must be up-to-date with master
        "contexts": REQUIRED_CHECKS,
    },
    "enforce_admins": True,  # nobody — including the owner — bypasses CI
    "required_pull_request_reviews": {
        "dismiss_stale_reviews": False,
        "require_code_owner_reviews": False,
        "required_approving_review_count": 0,  # PR required, approval not
    },
    "restrictions": None,
    "allow_force_pushes": False,
    "allow_deletions": False,
    "required_linear_history": True,  # rebase/ff merges only (repo style)
}


def main():
    if not TOKEN:
        print("Set GITHUB_TOKEN in the environment first.")
        sys.exit(1)
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/branches/{BRANCH}/protection",
        data=json.dumps(PAYLOAD).encode(),
        headers={
            "Authorization": f"token {TOKEN}",
            "Accept": "application/vnd.github+json",
        },
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = json.load(resp)
            print("branch protection applied:")
            print(f"  branch: {BRANCH}")
            print(f"  required checks: {len(REQUIRED_CHECKS)}")
            for c in REQUIRED_CHECKS:
                print(f"    - {c}")
            print(f"  enforce_admins: {body['enforce_admins']['enabled']}")
            print(f"  linear history: {body['required_linear_history']['enabled']}")
            print(f"  PRs required: yes (0 approvals)")
    except urllib.error.HTTPError as e:
        print(f"FAILED: {e.code} {e.reason}")
        print(e.read().decode()[:500])
        sys.exit(1)


if __name__ == "__main__":
    main()
