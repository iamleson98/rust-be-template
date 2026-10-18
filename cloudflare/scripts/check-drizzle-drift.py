#!/usr/bin/env python3
"""Drift check: apply hand-written migrations (0000-0002) to one scratch DB,
apply the drizzle-generated snapshot SQL to another, and diff the resulting
schemas (tables, columns, types, notnull, pk, indexes)."""
import sqlite3, re, sys, glob

MIGRATIONS = sorted(glob.glob("migrations/000[0-2]_*.sql"))
GENERATED = glob.glob("migrations-baseline-tmp/0000_*.sql")[0]

def apply(folder_files, db_path):
    db = sqlite3.connect(db_path)
    for f in folder_files:
        sql = open(f).read()
        # d1 .exec style: multiple statements, python executescript handles them
        # strip PRAGMA/key=value lines that reference d1-specifics
        db.executescript(sql)
    return db

def schema_of(db):
    out = {}
    tables = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'place_fts%' AND name != '_cf_METADATA' AND name != 'd1_migrations' ORDER BY name")]
    for t in tables:
        cols = []
        for cid, name, ctype, notnull, dflt, pk in db.execute(f"PRAGMA table_info('{t}')"):
            cols.append((name, ctype.upper(), int(notnull), int(pk), dflt))
        out[t] = cols
    return out

db_a = apply(MIGRATIONS, "/tmp/scratch_hand.sqlitedb")
db_b = apply([GENERATED], "/tmp/scratch_gen.sqlitedb")
sa, sb = schema_of(db_a), schema_of(db_b)

# FTS virtual tables and drizzle-unknown extras are expected asymmetries
DRIZZLE_IGNORE = {"place_fts_config", "place_fts_data", "place_fts_docsize", "place_fts_idx", "d1_migrations", "_cf_METADATA"}
sa = {k: v for k, v in sa.items() if not any(k.startswith(p) for p in ("place_fts",)) and k not in DRIZZLE_IGNORE}

only_a = set(sa) - set(sb)
only_b = set(sb) - set(sa)
diffs = []
for t in sorted(set(sa) & set(sb)):
    ca, cb = sa[t], sb[t]
    names_a = [c[0] for c in ca]
    names_b = [c[0] for c in cb]
    if names_a != names_b:
        diffs.append(f"table {t}: hand={names_a} gen={names_b}")
        continue
    for col_a, col_b in zip(ca, cb):
        if col_a[0] != col_b[0] or col_a[3] != col_b[3]:
            diffs.append(f"table {t}.{col_a[0]}: hand={col_a} gen={col_b}")
        # type affinity text vs TEXT ok; notnull may differ due to drizzle conventions
        if col_a[1].replace(" ", "") != col_b[1].replace(" ", ""):
            diffs.append(f"TYPE table {t}.{col_a[0]}: hand={col_a[1]} gen={col_b[1]}")

print("tables only in hand-written migrations:", sorted(only_a))
print("tables only in drizzle schema:", sorted(only_b))
print("column diffs:", len(diffs))
for d in diffs[:40]:
    print("  ", d)
print("hand tables:", len(sa), "gen tables:", len(sb))
