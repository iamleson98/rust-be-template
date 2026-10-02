# DB Size Runbook — "is the file size normal?"

Answers the recurring question — **"the database file is X MB, is that
right? would SQLite be smaller?"** — with numbers instead of guesswork,
using two admin endpoints shipped in `perf/ws-call-scalability`.

## Background (what we already know about the format)

The engine is **rust-sql (rustqlite)**, on-disk format `RSQLDB05`, 4 KiB
pages. Benchmarks on identical data (engine build `d76bbb9`, see the
`dbsize_exp*.py` experiments):

| Measurement | Result |
| --- | --- |
| Same data, fresh file | native ≈ **1.07 ×** the VACUUM-INTO SQLite file |
| Delete 25% contiguous, re-insert same volume | freelist pages fully **reused** (0 leaked) |
| Scattered deletes | pages stay ~80% full — **SQLite behaves identically** |
| `VACUUM` | shrinks the file (305.8 → 258.0 MB in the test) |
| WAL growth | bounded by `wal_autocheckpoint=1000` pages |

**Conclusion:** the format is NOT a bloat cause. A big file means either
(a) the live data genuinely is that big, or (b) churn fragmentation —
which `VACUUM` fixes. The endpoints below tell you which.

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
* `pragmas.cacheKiB` — engine-wide page cache budget (DATABASE_CACHE_KIB,
  default 64 MiB). Sanity: if this reads 2048, the v0.5.21 cache fix is
  not live.

`topTables` may be `null` if the engine build lacks the `dbstat` virtual
table — the rest of the report is unaffected.

## 2. Probe the ground-truth compacted size

```bash
curl -s "https://datxevui.com/api/admin/system/database?probe=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.probe'
```

`probe=1` runs `VACUUM INTO` a throwaway temp file, measures it, deletes
it. `compactedBytes` is what the SAME live data costs on a fresh,
fully-compacted copy of the SAME engine — the one number that settles
"is my file bloated".

**Cost:** one full-DB read + one compacted write + free disk ≈ the
compacted size. On the current prod DB expect tens of seconds and ~2 GB
temp space. Don't run it during a write burst.

### Reading the result

| `liveRatio` (`compacted / db`) | Meaning | Action |
| --- | --- | --- |
| `≥ 0.9` | The file ≈ its live data — size is NORMAL | Nothing. The data is just that big. |
| `0.7 – 0.9` | Moderate slack (freelist + fragmentation) | Optional VACUUM; check again after the next busy week. |
| `< 0.7` | Real bloat — ≥ 30% of the file is reclaimable | VACUUM (§3) + investigate what churns. |

Note: `probe.compactedBytes ≈ SQLite × 0.93` for the same data (the
1.07 × format overhead runs in reverse here) — so "would SQLite be
smaller?" is answered too: only by that factor, before ITS OWN
fragmentation.

## 3. Compact (guarded VACUUM)

```bash
curl -X POST https://datxevui.com/api/admin/system/database/vacuum \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

* Rebuilds the file in place: drops freelist + fragmentation slack,
  then checkpoints the WAL so `afterBytes` is honest.
* Takes the engine's single write lock for the duration — concurrent
  writers QUEUE (they don't fail), but latency spikes. Run it in a
  quiet window; expect roughly a full-DB read+write of wall time.
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
| `DATABASE_CACHE_KIB` | 65536 | Engine-wide page cache (v0.5.21 fix; do not lower below the working set). |
| `wal_autocheckpoint` | 1000 pages | WAL bound — already engine-managed. |
| `WS_SLOW_CONSUMER_THRESHOLD` | 128 | Not DB, but the same "RAM does not accumulate" story on the WS side. |
