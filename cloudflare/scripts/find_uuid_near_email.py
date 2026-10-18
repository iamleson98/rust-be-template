#!/usr/bin/env python3
"""Find UUID bytes adjacent to an email string in the native-format DB.

Usage: find_uuid_near_email.py <db_path> <email>
"""
import sys
import uuid


def main() -> int:
    db_path, email = sys.argv[1], sys.argv[2]
    needle = email.encode()
    data = open(db_path, "rb").read()
    pos = 0
    found = []
    while True:
        i = data.find(needle, pos)
        if i < 0:
            break
        pos = i + 1
        # Scan a window before/after the email for a plausible UUIDv4
        # (16 bytes, version nibble 4, RFC-4122 variant bits).
        for start in range(max(0, i - 80), min(len(data) - 16, i + len(needle) + 80)):
            chunk = data[start : start + 16]
            if chunk[6] >> 4 == 4 and (chunk[8] >> 6) == 2:
                try:
                    u = uuid.UUID(bytes=chunk)
                except ValueError:
                    continue
                # Only report if all bytes are "uuid-ish" (avoid random text)
                found.append((start, u, start - i))
    # Dedupe and print
    seen = set()
    for _, u, dist in found:
        if u not in seen:
            seen.add(u)
            print(f"{u}  (offset {dist:+d} from email)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
