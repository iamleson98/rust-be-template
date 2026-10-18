#!/usr/bin/env python3
"""Follow-up: verify DELETE/VACUUM behavior on the rustqlite NATIVE container.

The first experiment hinted that after deleting 40% of chat rows:
  freelist_count stayed 0 and VACUUM reclaimed 0 bytes.
Need to verify with strict error capture:
 1. did the DELETE actually run (row counts)?
 2. does the native container ever populate freelist_count?
 3. does VACUUM shrink the native file? does VACUUM INTO?
 4. what does dbstat say post-delete (unused space in pages)?
"""
import os
import subprocess
import sys

CLI = "/tmp/rust-be-template/rust-sql/target/debug/rustqlite-cli"
EXP = "/tmp/dbsize-exp"
DB = f"{EXP}/native.db"
OUT2 = f"{EXP}/sqlite_export2.db"


def run_sql(db: str, sql: str, timeout: int = 570) -> tuple[str, str]:
    p = subprocess.run(
        [CLI, db],
        input=".mode csv\n" + sql + "\n",
        capture_output=True, text=True, timeout=timeout,
    )
    out_lines = []
    for ln in p.stdout.splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith("rustqlite v") or s == "Type .help for help, .quit to exit.":
            continue
        if s.startswith("rustqlite>"):
            # keep 'rustqlite> error: ...' content, drop bare prompts
            if s.startswith("rustqlite> error:"):
                out_lines.append(s.replace("rustqlite> error:", "ERROR:").strip())
            continue
        out_lines.append(ln)
    return "\n".join(out_lines), p.stderr.strip()


def fsize(p: str) -> int:
    return os.path.getsize(p) if os.path.exists(p) else 0


def mb(n: float) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


def show(db: str, label: str):
    rows, _ = run_sql(db, "SELECT (SELECT COUNT(*) FROM chat_message) || ' chat rows';")
    pc, _ = run_sql(db, "PRAGMA page_count;")
    fc, _ = run_sql(db, "PRAGMA freelist_count;")
    jm, _ = run_sql(db, "PRAGMA journal_mode;")
    print(f"[{label}] chat={rows.strip()}  page_count={pc.strip()}  freelist={fc.strip()}  journal={jm.strip()}  file={mb(fsize(db))}")


def main() -> None:
    for f in (OUT2, OUT2 + "-wal", OUT2 + "-shm"):
        if os.path.exists(f):
            os.remove(f)

    show(DB, "current state (post delete+vacuum from exp1)")

    print("\n== dbstat (unused space inside pages) ==")
    stat, err = run_sql(DB, "SELECT name, SUM(pgsize) AS bytes, SUM(unused) AS unused FROM dbstat GROUP BY name ORDER BY bytes DESC;")
    print(stat or err)

    print("\n== delete another 20% (strict) ==")
    out, err = run_sql(DB, "DELETE FROM chat_message WHERE id % 5 = 2;")
    if err:
        print("STDERR:", err)
    show(DB, "after delete id%5=2")

    print("\n== VACUUM (strict) ==")
    out, err = run_sql(DB, "VACUUM;", timeout=570)
    if err:
        print("STDERR:", err)
    show(DB, "after VACUUM")

    print("\n== VACUUM INTO after deletes ==")
    out, err = run_sql(DB, f"VACUUM INTO '{OUT2}';", timeout=570)
    if err:
        print("STDERR:", err)
    print(f"VACUUM INTO output: {mb(fsize(OUT2))}")
    with open(OUT2, "rb") as fh:
        magic = fh.read(16)
    print(f"sqlite magic ok: {magic[:6] == b'SQLite'}")
    rows, _ = run_sql(OUT2, "SELECT (SELECT COUNT(*) FROM chat_message) || ' chat rows';")
    pc, _ = run_sql(OUT2, "PRAGMA page_count;")
    fc, _ = run_sql(OUT2, "PRAGMA freelist_count;")
    print(f"[sqlite export] chat={rows.strip()} page_count={pc.strip()} freelist={fc.strip()}")

    print("\n== summary ==")
    print(f"native file: {mb(fsize(DB))}")
    print(f"sqlite export of same (post-delete) data: {mb(fsize(OUT2))}")


if __name__ == "__main__":
    main()
