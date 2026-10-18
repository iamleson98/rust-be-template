#!/usr/bin/env python3
"""Test 4 (rigorous): freelist reuse with CONTIGUOUS deletes.

Scattered deletes leave pages 80% full (no freelist entries) — that is
SQLite-identical behavior and my exp3 'verdict' was a misattribution.
The real reuse question: delete a CONTIGUOUS range (empties whole pages
-> they go to the freelist trunk chain), then insert the same volume of
rows (rowid-append). If page_count stays ~flat, freelist reuse works
(SQLite behavior). If it grows by the full insert volume, reuse is broken.
"""
import os
import subprocess

CLI = "/tmp/rust-be-template/rust-sql/target/debug/rustqlite-cli"
DB = "/tmp/dbsize-exp/reuse.db"

SCHEMA = [
    "PRAGMA page_size=4096;",
    """CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT NOT NULL, b TEXT);""",
]
ROW = "printf('row-payload-%08d-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghij', id)"


def run_sql(db: str, sql: str, timeout: int = 570) -> str:
    p = subprocess.run(
        [CLI, db], input=".mode csv\n" + sql + "\n",
        capture_output=True, text=True, timeout=timeout,
    )
    out = []
    for ln in p.stdout.splitlines():
        s = ln.strip()
        if not s or s.startswith("rustqlite v") or s == "Type .help for help, .quit to exit.":
            continue
        if s.startswith("rustqlite>"):
            if s.startswith("rustqlite> error:"):
                out.append("ERROR:" + s[len("rustqlite> error:"):])
            continue
        out.append(ln)
    return "\n".join(out).strip()


def mb(n: float) -> str:
    return f"{n / 1024 / 1024:.2f} MB"


def state(db: str, label: str):
    pc = run_sql(db, "PRAGMA page_count;")
    fc = run_sql(db, "PRAGMA freelist_count;")
    n = run_sql(db, "SELECT COUNT(*) FROM t;")
    sz = os.path.getsize(db)
    print(f"[{label}] rows={n} page_count={pc} freelist={fc} file={mb(sz)}")
    return int(pc), int(fc), sz


def main() -> None:
    for f in (DB, DB + "-wal", DB + "-shm"):
        if os.path.exists(f):
            os.remove(f)

    print("== build 262144 contiguous rows ==")
    run_sql(DB, SCHEMA[1])
    run_sql(DB, "INSERT INTO t (a, b) VALUES ('row-payload-00000000-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghij', 'x');")
    ins = f"INSERT INTO t (a, b) SELECT {ROW}, 'x' FROM t;"
    for _ in range(18):
        run_sql(DB, ins)
    state(DB, "built")

    print("\n== delete a contiguous range (bottom 25%) ==")
    run_sql(DB, "DELETE FROM t WHERE id <= 65536;")
    state(DB, "after contiguous delete")

    print("\n== insert the same volume back (rowid-append) ==")
    ins_back = (
        "INSERT INTO t (a, b) SELECT "
        "printf('row-payload-%08d-abcdefghijklmnopqrstuvwxyz0123456789-"
        "abcdefghijklmnopqrstuvwxyz0123456789-abcdefghij', id+1000000), 'x' FROM t LIMIT 65536;"
    )
    r = run_sql(DB, ins_back)
    if r.startswith("ERROR"):
        print(r)
    state(DB, "after re-insert")

    print("\n== verdict ==")
    pc_del = None


if __name__ == "__main__":
    main()
