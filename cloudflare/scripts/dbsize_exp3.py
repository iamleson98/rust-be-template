#!/usr/bin/env python3
"""Test 3: does the native container REUSE freed pages (no monotonic growth)?

Procedure on the existing native.db (258 MB, 419430 chat rows):
 1. delete 20% (scattered)  -> file size should stay (free pages held)
 2. insert ~100k new rows   -> if file grows ONLY by the net-new data,
    freed pages are being reused (good, SQLite-like);
    if it grows by full new data + stays bloated, reuse is broken.
"""
import os
import subprocess
import sys

CLI = "/tmp/rust-be-template/rust-sql/target/debug/rustqlite-cli"
DB = "/tmp/dbsize-exp/native.db"


def run_sql(sql: str, timeout: int = 570) -> str:
    p = subprocess.run(
        [CLI, DB], input=".mode csv\n" + sql + "\n",
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
    return f"{n / 1024 / 1024:.1f} MB"


def state(label: str):
    rows = run_sql("SELECT COUNT(*) FROM chat_message;")
    pc = run_sql("PRAGMA page_count;")
    fc = run_sql("PRAGMA freelist_count;")
    sz = os.path.getsize(DB)
    print(f"[{label}] rows={rows} page_count={pc} freelist={fc} file={mb(sz)}")
    return sz


def main() -> None:
    s0 = state("baseline")

    print("\n-- delete 20% scattered --")
    r = run_sql("DELETE FROM chat_message WHERE id % 5 = 3;")
    if r.startswith("ERROR"):
        print(r)
    s1 = state("after delete")

    print("\n-- insert 104858 new rows (20%) --")
    ins = """INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1),
  json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997)),
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM chat_message LIMIT 104858;"""
    r = run_sql(ins)
    if r.startswith("ERROR"):
        print(r)
    s2 = state("after insert")

    print("\n-- verdict --")
    print(f"delete freed ~20% of table space; insert added 104858 rows")
    print(f"file: {mb(s0)} -> {mb(s1)} (delete) -> {mb(s2)} (insert)")
    if s2 <= s1 + 5 * 1024 * 1024:
        print("VERDICT: freed pages are REUSED (no monotonic growth) — SQLite-like behavior")
    else:
        print(f"VERDICT: file grew {mb(s2 - s1)} on top of the freed space — freed pages NOT reused!")


if __name__ == "__main__":
    main()
