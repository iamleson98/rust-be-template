# DB Size Runbook — "is the file size normal?"

Answers the recurring question — **"the database file is X MB, is that
right? would SQLite be smaller?"** — with numbers instead of guesswork,
using two admin endpoints shipped in `perf/ws-call-scalability`.

## Background

The engine is **real SQLite** (the `begin-concurrent` build, plain WAL
mode), 4 KiB pages. Two things make the file bigger than its live data:

* **Freelist pages** — space freed by deletes, reused by later writes, so
  an active file stops growing.
* **Fragmentation** — scattered deletes leave pages partly full; only
  `VACUUM` repacks them.

The WAL (`app.db-wal`) is separate: the app checkpoints it every minute
(PASSIVE) and truncates it nightly at 04:00 local time
(`src/db/checkpoint.rs`), and `wal_autocheckpoint=1000` pages bounds it
between ticks.

A big file therefore means either (a) the live data genuinely is that
big, or (b) churn fragmentation — which `VACUUM` fixes. The endpoints
below tell you which.

## 1. Read the size report (no side effects)

```bash
curl -s https://datxevui.com/api/admin/system/database \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

What to look at:

* `files.dbBytes` + `files.walBytes` — the real on-disk footprint.
* `pragmas.freelistPages` — pages reusable by future writes but still
  occupying file space. `freelistPages × pageSize` is the floor of what
  a VACUUM can reclaim.
* `topTables[]` — the 25 largest objects (tables + indexes). This is
  how you find "the audit log is 400 MB" style answers.
* `pragmas.cacheKiB` — page cache budget of EACH pooled connection
  (`DATABASE_CACHE_KIB`, default 8 MiB), not a process-wide total.

`topTables` may be `null` if the `dbstat` virtual table is unavailable —
the rest of the report is unaffected.

## 2. Probe the ground-truth compacted size

```bash
curl -s "https://datxevui.com/api/admin/system/database?probe=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.probe'
```

`probe=1` runs `VACUUM INTO` a throwaway temp file, measures it, deletes
it. `compactedBytes` is what the SAME live data costs on a fresh,
fully-compacted copy — the one number that settles "is my file
bloated".

**Cost:** one full-DB read + one compacted write + free disk ≈ the
compacted size. On the current prod DB expect tens of seconds and ~2 GB
temp space. Don't run it during a write burst.

### Reading the result

| `liveRatio` (`compacted / db`) | Meaning | Action |
| --- | --- | --- |
| `≥ 0.9` | The file ≈ its live data — size is NORMAL | Nothing. The data is just that big. |
| `0.7 – 0.9` | Moderate slack (freelist + fragmentation) | Optional VACUUM; check again after the next busy week. |
| `< 0.7` | Real bloat — ≥ 30% of the file is reclaimable | VACUUM (§3) + investigate what churns. |

## 3. Compact (guarded VACUUM)

```bash
curl -X POST https://datxevui.com/api/admin/system/database/vacuum \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

* Rebuilds the file in place: drops freelist + fragmentation slack,
  then checkpoints the WAL so `afterBytes` is honest.
* Takes SQLite's write lock for the duration — concurrent writers wait
  up to the 5 s `busy_timeout` and then fail with a busy error (the app
  retries those where it can), so run it in a quiet window; expect
  roughly a full-DB read+write of wall time and free disk of about the
  database size.
* `reclaimedBytes` will be small when the file was already tight — that
  is a normal answer, not a failure.
* RBAC-gated (`admin:stats:read`), logged at INFO with before/after.

### Cadence

There is no cron for VACUUM on purpose: freelist pages are REUSED by
future writes, so an un-vacuumed-but-active file stops growing. Probe
quarterly or after a large purge (GDPR delete, audit-log trim); VACUUM
only when `liveRatio < 0.9` AND the absolute reclaim is worth the window.

## 4. If the file is big but `liveRatio ≈ 1`

The data is real. Use `topTables` to find the owners, then shrink the
data, not the file:

* audit/notification/history tables → prune by retention policy;
* `chat_message` growth → archive cold channels;
* bloat in indexes (names ending in `_idx`) → check the migration list
  (m20261002_000016 added the hot-path set; more are additive).

## Related knobs

| Knob | Default | Effect |
| --- | --- | --- |
| `DATABASE_CACHE_KIB` | 8192 | Page cache PER pooled connection; total ≈ `DATABASE_MAX_CONNECTIONS` × this. |
| `wal_autocheckpoint` | 1000 pages | WAL bound between the background checkpoint ticks. |
| `WS_SLOW_CONSUMER_THRESHOLD` | 128 | Not DB, but the same "RAM does not accumulate" story on the WS side. |
