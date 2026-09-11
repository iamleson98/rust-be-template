#!/usr/bin/env python3
"""Export the schema catalog from a rustqlite (`RSQLDB0x`) database file.

The file is not SQLite — it is the engine in rust-sql/ with its own page
format. This reader walks the schema B+tree rooted at page 0 and decodes
the sqlite_master-equivalent rows: (type, name, tbl_name, rootpage, sql).

Usage:
    python scripts/export_db_schema.py app.db                 # SQL dump
    python scripts/export_db_schema.py app.db --format json
    python scripts/export_db_schema.py app.db -o schema.sql
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

DB_HEADER_SIZE = 100
PAGE_HEADER_SIZE = 12
SUPPORTED_MAGIC = (b"RSQLDB02", b"RSQLDB03", b"RSQLDB04")

PT_INTERIOR_TABLE = 0x05
PT_LEAF_TABLE = 0x0D
PT_INTERIOR_INDEX = 0x02
PT_LEAF_INDEX = 0x0A
PT_OVERFLOW = 0x04


class CorruptError(Exception):
    pass


# --- primitive decoders (mirror rust-sql/src/storage/btree.rs varint) ------


def decode_varint(buf: memoryview, off: int) -> tuple[int, int]:
    """SQLite-style big-endian varint. Returns (value, bytes consumed)."""
    v = 0
    for i in range(9):
        if off + i >= len(buf):
            raise CorruptError("truncated varint")
        b = buf[off + i]
        if i == 8:
            return ((v << 8) | b) & 0xFFFFFFFFFFFFFFFF, 9
        v = (v << 7) | (b & 0x7F)
        if not b & 0x80:
            return v, i + 1
    raise CorruptError("varint too long")


def decode_signed_varint(buf: memoryview, off: int) -> tuple[int, int]:
    v, n = decode_varint(buf, off)
    if v >= 1 << 63:
        v -= 1 << 64
    return v, n


def decode_uvarint(buf: memoryview, off: int) -> tuple[int, int]:
    """LEB128 varint used for TEXT/BLOB lengths in the row codec."""
    n = 0
    shift = 0
    i = off
    while i < len(buf):
        b = buf[i]
        n |= (b & 0x7F) << shift
        shift += 7
        i += 1
        if not b & 0x80:
            return n, i - off
        if shift >= 64:
            raise CorruptError("varint too long")
    raise CorruptError("truncated varint")


# --- value codec v2 (mirror rust-sql/src/types/value.rs Value::decode) -----


def decode_value(buf: memoryview, off: int):
    if off >= len(buf):
        raise CorruptError("empty value buffer")
    tag = buf[off]
    rest = off + 1
    if tag == 0x00 or tag == 0x09:
        return None, 1
    if tag == 0x01:
        return 0, 1
    if tag == 0x02:
        return struct.unpack_from("<b", buf, rest)[0], 2
    if tag == 0x03:
        return struct.unpack_from("<h", buf, rest)[0], 3
    if tag == 0x04:
        return struct.unpack_from("<i", buf, rest)[0], 5
    if tag == 0x05:
        return struct.unpack_from("<q", buf, rest)[0], 9
    if tag == 0x06:
        return struct.unpack_from("<d", buf, rest)[0], 9
    if tag in (0x07, 0x08):
        ln, n = decode_uvarint(buf, rest)
        body = bytes(buf[rest + n : rest + n + ln])
        if len(body) != ln:
            raise CorruptError("truncated text/blob body")
        return (body.decode("utf-8") if tag == 0x07 else body), 1 + n + ln
    if tag == 0x0A:
        z, n = decode_uvarint(buf, rest)
        return float((z >> 1) ^ -(z & 1)), 1 + n
    raise CorruptError(f"unknown value tag {tag:#x}")


def decode_row(payload: bytes) -> list:
    mv = memoryview(payload)
    out = []
    off = 0
    while off < len(mv):
        v, n = decode_value(mv, off)
        out.append(v)
        off += n
    return out


# --- page / b-tree walking -------------------------------------------------


def overflow_local_len(total: int, page_size: int) -> int:
    max_local = max(page_size - 128, 0)
    if total <= max_local:
        return total
    chain_cap = max(page_size - 16, 1)
    min_local = min(max(page_size // 4, 16), max(max_local - 8, 16))
    surplus = min_local + (total - min_local) % chain_cap
    return surplus if surplus <= max_local else min_local


class Database:
    def __init__(self, path: Path):
        self.data = path.read_bytes()
        if len(self.data) < DB_HEADER_SIZE:
            raise CorruptError("file smaller than the database header")
        self.magic = self.data[:8]
        if self.magic not in SUPPORTED_MAGIC:
            raise CorruptError(
                f"unexpected magic {self.magic!r} (not a rustqlite database)"
            )
        self.page_size = struct.unpack_from("<I", self.data, 8)[0]
        if self.page_size < 512 or self.page_size & (self.page_size - 1):
            raise CorruptError(f"invalid page size {self.page_size}")
        self.page_count = struct.unpack_from("<I", self.data, 16)[0]
        self.schema_cookie = struct.unpack_from("<I", self.data, 28)[0]
        self.user_version = struct.unpack_from("<I", self.data, 60)[0]
        self.application_id = struct.unpack_from("<I", self.data, 68)[0]

    def page(self, pid: int) -> memoryview:
        start = pid * self.page_size
        end = start + self.page_size
        if end > len(self.data):
            raise CorruptError(f"page {pid} is past end of file")
        return memoryview(self.data)[start:end]

    @staticmethod
    def _hdr_off(pid: int) -> int:
        return DB_HEADER_SIZE if pid == 0 else 0

    def read_overflow(self, first: int, want: int) -> bytes:
        out = bytearray()
        pid = first
        seen = set()
        while pid and len(out) < want:
            if pid in seen:
                raise CorruptError("overflow chain loop")
            seen.add(pid)
            pg = self.page(pid)
            if pg[0] != PT_OVERFLOW:
                raise CorruptError(f"page {pid} is not an overflow page")
            nxt = struct.unpack_from(">I", pg, 12)[0]
            out += bytes(pg[16 : 16 + min(want - len(out), self.page_size - 16)])
            pid = nxt
        if len(out) != want:
            raise CorruptError("overflow chain shorter than payload length")
        return bytes(out)

    def scan_table(self, root: int):
        """Yield (rowid, payload_bytes) for every row of a table B+tree."""
        stack = [root]
        visited = set()
        while stack:
            pid = stack.pop()
            if pid in visited:
                raise CorruptError("b-tree page cycle")
            visited.add(pid)
            pg = self.page(pid)
            ho = self._hdr_off(pid)
            ptype = pg[ho]
            n_cells = struct.unpack_from(">H", pg, ho + 4)[0]
            ptr_base = ho + PAGE_HEADER_SIZE
            if ptype == PT_INTERIOR_TABLE:
                children = []
                for i in range(n_cells):
                    cp = struct.unpack_from(">H", pg, ptr_base + i * 2)[0]
                    children.append(struct.unpack_from(">I", pg, cp)[0])
                right = struct.unpack_from(">I", pg, ho + 8)[0]
                if right:
                    children.append(right)
                stack.extend(reversed(children))
                continue
            if ptype != PT_LEAF_TABLE:
                raise CorruptError(f"page {pid}: unexpected page type {ptype:#x}")
            for i in range(n_cells):
                cp = struct.unpack_from(">H", pg, ptr_base + i * 2)[0]
                rowid, n = decode_signed_varint(pg, cp)
                total, m = decode_varint(pg, cp + n)
                body = cp + n + m
                local_len = overflow_local_len(total, self.page_size)
                if local_len == total:
                    payload = bytes(pg[body : body + total])
                else:
                    head = bytes(pg[body : body + local_len])
                    chain = struct.unpack_from(">I", pg, body + local_len)[0]
                    payload = head + self.read_overflow(chain, total - local_len)
                yield rowid, payload


def read_schema(db: Database) -> list[dict]:
    entries = []
    for rowid, payload in db.scan_table(0):
        row = decode_row(payload)
        row += [None] * (5 - len(row))
        entries.append(
            {
                "rowid": rowid,
                "type": row[0],
                "name": row[1],
                "tbl_name": row[2],
                "rootpage": row[3],
                "sql": row[4],
            }
        )
    return entries


# --- output ----------------------------------------------------------------

KIND_ORDER = {"table": 0, "view": 1, "index": 2, "trigger": 3}


def render_sql(db: Database, entries: list[dict]) -> str:
    lines = [
        f"-- rustqlite schema dump ({db.magic.decode()}, page_size={db.page_size},"
        f" pages={db.page_count}, user_version={db.user_version})",
        "",
    ]
    ordered = sorted(
        entries,
        key=lambda e: (KIND_ORDER.get(e["type"] or "", 9), e["tbl_name"] or "", e["name"] or ""),
    )
    for e in ordered:
        if not e["sql"]:
            lines.append(f"-- {e['type']} {e['name']}: implicit (no stored SQL)")
            continue
        stmt = e["sql"].strip()
        if not stmt.endswith(";"):
            stmt += ";"
        lines.append(stmt)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("database", nargs="?", default="app.db", type=Path)
    ap.add_argument("-f", "--format", choices=("sql", "json"), default="sql")
    ap.add_argument("-o", "--output", type=Path, help="write to a file instead of stdout")
    args = ap.parse_args()

    try:
        db = Database(args.database)
        entries = read_schema(db)
    except (CorruptError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.format == "json":
        text = json.dumps(
            {
                "format": db.magic.decode(),
                "page_size": db.page_size,
                "page_count": db.page_count,
                "schema_cookie": db.schema_cookie,
                "user_version": db.user_version,
                "application_id": db.application_id,
                "objects": entries,
            },
            indent=2,
            ensure_ascii=False,
        ) + "\n"
    else:
        text = render_sql(db, entries)

    if args.output:
        args.output.write_text(text, encoding="utf-8")
        print(f"wrote {args.output} ({len(entries)} objects)", file=sys.stderr)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
