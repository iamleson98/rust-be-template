#!/usr/bin/env python3
"""Dump printable strings immediately following an email in the raw DB
to identify each user's status/role values.

Usage: dump_after_email.py <db_path> <email> [count]
"""
import re
import sys


def printable_runs(buf: bytes, start: int, end: int, min_len: int = 2):
    """Yield (offset, decoded) runs of printable ASCII in buf[start:end]."""
    run = bytearray()
    run_start = start
    for i in range(start, min(end, len(buf))):
        b = buf[i]
        if 32 <= b < 127:
            if not run:
                run_start = i
            run.append(b)
        else:
            if len(run) >= min_len:
                yield run_start, run.decode("ascii", "replace")
            run = bytearray()
    if len(run) >= min_len:
        yield run_start, run.decode("ascii", "replace")


def main() -> int:
    db_path, email = sys.argv[1], sys.argv[2]
    window = int(sys.argv[3]) if len(sys.argv) > 3 else 220
    data = open(db_path, "rb").read()
    needle = email.encode()
    pos = 0
    n = 0
    while n < 3:
        i = data.find(needle, pos)
        if i < 0:
            break
        pos = i + 1
        n += 1
        print(f"--- occurrence at {i}:")
        for off, s in printable_runs(data, i + len(needle), i + len(needle) + window):
            print(f"  +{off - i - len(needle):4d}  {s!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
