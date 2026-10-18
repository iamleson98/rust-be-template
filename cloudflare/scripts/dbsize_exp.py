#!/usr/bin/env python3
"""DB size experiment: rustqlite native format vs SQLite format, same data.

Questions this answers (user 2026-10-02):
 1. Would the exact same data in a SQLite db file have a similar file size?
 2. What does 'abnormal' size look like (freelist bloat) and what fixes it?

Method:
 - Build one native-format (RSQLDB04) DB with ~500k chat rows + ~256k
   notification rows (~realistic Vietnamese text + JSON payloads).
 - Read page_count / freelist_count / dbstat.
 - VACUUM INTO a genuine SQLite-format file -> direct size comparison.
 - DELETE 40% of chat rows -> file size unchanged (freelist grows).
 - VACUUM -> file shrinks back.
 - WAL sidecar growth test + wal_checkpoint(TRUNCATE).
"""
import os
import subprocess
import sys

CLI = "/tmp/rust-be-template/rust-sql/target/debug/rustqlite-cli"
EXP = "/tmp/dbsize-exp"
DB = f"{EXP}/native.db"
SQLITE_OUT = f"{EXP}/sqlite_export.db"

CHAT_DOUBLINGS = 19   # 1 -> 524288 rows
NOTIF_DOUBLINGS = 18  # 1 -> 262144 rows


def gen_seed_sql() -> str:
    chat_row = """printf('Xin chào, tôi muốn hỏi về chuyến xe %d đi Đà Nẵng lúc %02d:00, còn vé không? Tôi cần %d ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu? Chuyến có dừng nghỉ ở trạm dọc không?',
    (id%50)+1, id%24, (id%4)+1)"""
    meta = """json_object('t','m','b',id%7,'f',1.5*(id%13),'ed',(id%2)=0,'r',printf('r-%d',id%997))"""
    ts = """printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)"""
    chat_ins = f"""INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
SELECT (id*7919)%500+1, (id*104729)%10000+1,
  'cm-' || ((id*2654435761)%1000000000),
  {chat_row},
  {meta},
  {ts}
FROM chat_message;
"""
    notif_ins = """INSERT INTO notification (user_id, kind, payload, read_at, created_at)
SELECT (id*7919)%10000+1,
  CASE id%5 WHEN 0 THEN 'booking.confirmed' WHEN 1 THEN 'booking.reminder' WHEN 2 THEN 'promo' WHEN 3 THEN 'chat.new_message' ELSE 'system' END,
  json_object('id',printf('b%07d',id),'code',printf('DXV-%d',100000+id),'trip',CASE id%4 WHEN 0 THEN 'Sài Gòn → Đà Nẵng' WHEN 1 THEN 'Hà Nội → Huế' WHEN 2 THEN 'Đà Nẵng → Nha Trang' ELSE 'Cần Thơ → Sài Gòn' END,'seats',json_array(printf('A%02d',id%40+1),printf('B%02d',id%30+1)),'amount',450000+id%550000,'cur','VND','ch',printf('ch-%d',id%500)),
  CASE WHEN id%3=0 THEN printf('2026-%02d-%02dT%02d:00:00Z',(id%12)+1,(id%28)+1,id%24) ELSE NULL END,
  printf('2026-%02d-%02dT%02d:%02d:%02d.%03dZ',(id%12)+1,(id%28)+1,id%24,(id*7)%60,(id*11)%60,id%999)
FROM notification;
"""
    parts = [
        "PRAGMA page_size=4096;",
        """CREATE TABLE chat_message (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  client_msg_id TEXT,
  content TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);""",
        "CREATE INDEX idx_chat_channel_time ON chat_message(channel_id, created_at);",
        """CREATE TABLE notification (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);""",
        "CREATE INDEX idx_notif_user ON notification(user_id, created_at);",
        f"""INSERT INTO chat_message (channel_id, sender_id, client_msg_id, content, meta, created_at)
VALUES (1, 1, 'cm-seed-1',
  'Xin chào, tôi muốn hỏi về chuyến xe đi Đà Nẵng tối nay còn vé không? Tôi cần 2 ghế hướng trước, gần cửa sổ nếu có thể. Cho tôi hỏi giá vé bao nhiêu và thời gian di chuyển dự kiến là bao lâu?',
  json_object('t','m','b',1,'f',1.5,'ed',false), '2026-01-01T00:00:00Z');""",
        """INSERT INTO notification (user_id, kind, payload, read_at, created_at)
VALUES (1, 'booking.confirmed',
  json_object('id','b0000001','code','DXV-100001','trip','Sài Gòn → Đà Nẵng','seats',json_array('A01','A02'),'amount',450000,'cur','VND'),
  NULL, '2026-01-01T00:00:00Z');""",
    ]
    parts += [chat_ins] * CHAT_DOUBLINGS
    parts += [notif_ins] * NOTIF_DOUBLINGS
    return "\n".join(parts)


def run_sql(db: str, sql: str, timeout: int = 570) -> str:
    # CLI reads one statement per line from stdin; prefix .mode csv for
    # clean parseable output.
    p = subprocess.run(
        [CLI, db],
        input=".mode csv\n" + sql + "\n",
        capture_output=True, text=True, timeout=timeout,
    )
    if p.returncode != 0:
        print(f"[SQL FAILED] {sql[:120]}\nstdout: {p.stdout}\nstderr: {p.stderr}", file=sys.stderr)
        sys.exit(1)
    # strip prompt noise: keep only non-empty lines that are not prompts
    lines = [ln for ln in p.stdout.splitlines() if ln.strip() and not ln.startswith("rustqlite>")]
    return "\n".join(lines)


def import_script(db: str, path: str) -> None:
    p = subprocess.run(
        [CLI, db, "--import", path],
        capture_output=True, text=True, timeout=570,
    )
    if p.returncode != 0:
        print(f"[IMPORT FAILED] stdout: {p.stdout}\nstderr: {p.stderr}", file=sys.stderr)
        sys.exit(1)
    if p.stderr.strip():
        print(f"[import stderr] {p.stderr}")


def fsize(path: str) -> int:
    return os.path.getsize(path) if os.path.exists(path) else 0


def mb(n: float) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


def main() -> None:
    os.makedirs(EXP, exist_ok=True)
    for f in (DB, f"{DB}-wal", f"{DB}-shm", SQLITE_OUT, f"{SQLITE_OUT}-wal", f"{SQLITE_OUT}-shm"):
        if os.path.exists(f):
            os.remove(f)

    seed_path = "/home/z/my-project/scripts/dbsize-exp-seed.sql"
    with open(seed_path, "w") as fh:
        fh.write(gen_seed_sql())

    print("== building native-format DB (this may take a few minutes) ==")
    import_script(DB, seed_path)

    print("\n== phase 1: baseline (fresh, compact) ==")
    rows = run_sql(DB, "SELECT (SELECT COUNT(*) FROM chat_message) || ' chat, ' || (SELECT COUNT(*) FROM notification) || ' notif';")
    print(f"rows: {rows.strip()}")
    ps = run_sql(DB, "PRAGMA page_size;").strip()
    pc = run_sql(DB, "PRAGMA page_count;").strip()
    fc = run_sql(DB, "PRAGMA freelist_count;").strip()
    print(f"page_size={ps} page_count={pc} freelist_count={fc}")
    stat = run_sql(DB, "SELECT name, SUM(pgsize) AS bytes, COUNT(*) AS pages FROM dbstat GROUP BY name ORDER BY bytes DESC;")
    print(f"dbstat:\n{stat}")
    base = fsize(DB)
    print(f"native file: {mb(base)}  (wal={mb(fsize(DB + '-wal'))})")

    print("\n== phase 2: VACUUM INTO -> genuine SQLite file ==")
    run_sql(DB, f"VACUUM INTO '{SQLITE_OUT}';", timeout=570)
    sq = fsize(SQLITE_OUT)
    print(f"sqlite export: {mb(sq)}")
    print(f"ratio sqlite/native: {sq / base:.4f}")
    # verify the export is a real SQLite file
    with open(SQLITE_OUT, "rb") as fh:
        magic = fh.read(16)
    print(f"sqlite magic ok: {magic[:6] == b'SQLite'}")

    print("\n== phase 3: DELETE 40% -> freelist bloat (file does NOT shrink) ==")
    run_sql(DB, "DELETE FROM chat_message WHERE id % 5 IN (0, 1);")
    pc2 = run_sql(DB, "PRAGMA page_count;").strip()
    fc2 = run_sql(DB, "PRAGMA freelist_count;").strip()
    print(f"page_count={pc2} freelist_count={fc2} (free = {mb(int(pc2 if pc2.isdigit() else 0))})")
    after_del = fsize(DB)
    print(f"native file after delete: {mb(after_del)}  (unchanged = {abs(after_del - base) < 1_000_000})")

    print("\n== phase 4: VACUUM -> reclaim ==")
    run_sql(DB, "VACUUM;", timeout=570)
    pc3 = run_sql(DB, "PRAGMA page_count;").strip()
    fc3 = run_sql(DB, "PRAGMA freelist_count;").strip()
    print(f"page_count={pc3} freelist_count={fc3}")
    after_vac = fsize(DB)
    print(f"native file after vacuum: {mb(after_vac)}")
    print(f"reclaimed: {mb(after_del - after_vac)} ({100 * (after_del - after_vac) / after_del:.1f}%)")

    print("\n== phase 5: WAL sidecar growth + checkpoint truncate ==")
    run_sql(DB, "PRAGMA journal_mode=WAL;")
    # burst of autocommit updates
    for i in range(6):
        run_sql(DB, f"UPDATE chat_message SET meta = json_set(meta, '$.b', {i}) WHERE id % 7 = 0;", timeout=570)
    wal = fsize(DB + "-wal")
    print(f"after 6 update bursts: db={mb(fsize(DB))} wal={mb(wal)}")
    run_sql(DB, "PRAGMA wal_checkpoint(TRUNCATE);")
    print(f"after wal_checkpoint(TRUNCATE): wal={mb(fsize(DB + '-wal'))}")

    print("\n== summary ==")
    print(f"native(compact)={mb(base)}  sqlite_export={mb(sq)}  delta={100 * (sq - base) / base:+.2f}%")
    print(f"after delete40%: {mb(after_del)}  after VACUUM: {mb(after_vac)}")


if __name__ == "__main__":
    main()
