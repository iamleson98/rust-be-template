#!/usr/bin/env python3
"""Swap no-op `rbac.check(...)` calls for enforcing `rbac.require(...)`.

`RbacChecker::check` returns `Result<bool>` — the bool was discarded at
every route call site, so permission grants were never enforced
(fail-open). `require` returns `Result<(), StoreError>` and yields
`Forbidden` (HTTP 403) when the caller lacks the permission.

Run from the repo root: python3 scripts/fix_rbac_checks.py
"""
import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROUTE_FILES = [
    "src/routes/users.rs",
    "src/routes/posts.rs",
    "src/routes/payments.rs",
    "src/routes/system.rs",
    "src/routes/nullclaw.rs",
    *sorted(str(p.relative_to(ROOT)) for p in (ROOT / "src/routes/admin").glob("*.rs")),
]

# `.rbac` + (newline + indent)? + `.check(` -> same with `.require(`
PATTERN = re.compile(r"(\.rbac\s*)\.check\(")

def main() -> None:
    total = 0
    for rel in ROUTE_FILES:
        path = ROOT / rel
        content = path.read_text()
        new, n = PATTERN.subn(r"\1.require(", content)
        if n:
            path.write_text(new)
        print(f"{rel}: {n} call(s) converted")
        total += n
    print(f"--- total: {total}")

if __name__ == "__main__":
    main()
