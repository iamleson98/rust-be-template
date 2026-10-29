# Running on the Cloudflare Free plan

The account is on the Workers **Free** plan and the goal is to stay there. This page lists every
scheduled or background piece of the system, what each costs, the limits that matter, and how to
check that nothing is drifting toward them. Numbers marked _measured_ come from this account;
limits come from Cloudflare's documentation (linked) and should be re-read before relying on them.

## Everything that runs on a schedule or in the background

| What                                                                                                             | Where it runs                                                           | Cadence                               | Cost on Free                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Job tick**: `holds.sweep` (cancel expired seat holds), then whichever table-driven job is due                  | the Worker, called by the VPS service (`vps/`) at `POST /api/jobs/tick` | every minute (1,440 runs/day)         | ~10 indexed D1 rows read per idle tick, one heartbeat row per 10 min, one driver heartbeat per 5 min       |
| **Cron Trigger** (safety net)                                                                                    | the Worker, `scheduled()` in `custom-worker.ts`                         | every minute                          | one indexed row read; runs the tick itself only when the VPS has not ticked for 7 minutes                  |
| `trips.warm` (create trip sessions for the 14-day sales window)                                                  | same tick, gated to once per 6 h                                        | 4 runs/day                            | creates only the missing `trip_session` rows; seat inventory is created lazily on the first hold           |
| `coupons.expire` (the campaign scan: expire unused coupons whose window passed), `jobs.retention`, `trips.prune` | same tick, claimed through `scheduled_job.next_run_at`                  | daily (editable in the admin console) | a handful of rows each                                                                                     |
| **OpenStreetMap place index** (Rust `osm.import`)                                                                | the VPS service, in memory                                              | weekly (Monday 03:30 Vietnam time)    | nothing on Cloudflare; one VPS core for ~45 s at the lowest priority                                       |
| Static fallback place index                                                                                      | GitHub Actions `place-index.yml`, a free runner                         | weekly (Sunday 20:17 UTC)             | nothing at runtime: the shards ship as static assets, used only when the VPS does not answer               |
| Realtime chat and audio-call signalling                                                                          | Durable Objects `ChatHub` / `CallHub`                                   | event driven, no cron                 | idle sockets hibernate (no duration billed); heartbeats are answered by the platform without waking the DO |
| Call ring timeout and grace period                                                                               | `CallHub` storage alarm                                                 | only while a call is ringing          | one alarm per call                                                                                         |

There are no other Cron Triggers, queues or workflows. The single trigger uses one of the Free
plan's five cron slots.

## Why the VPS drives the jobs, and the Worker only backs it up

- The VPS calls the tick every minute with retries and keeps a per-job record (`/admin/system`),
  so a failing job is visible in one place; the Worker's trigger costs one indexed read a minute
  while it stands down.
- Both paths run the same executor in the Worker, so the D1 rules below apply to either.
- If the VPS stops, the trigger notices the stale `cron.driver` heartbeat and runs the jobs within
  7 minutes; nothing needs to be switched by hand.

## Why one tick every minute is the right shape

- A held seat is only released by the sweep (the seat claim does not treat an expired hold as
  free), so the cadence is the delay a customer sees before a lapsed seat can be bought again.
  Every minute matches the Rust scheduler and costs almost nothing now.
- Everything else rides the same tick and is throttled by its own gate, so there is exactly one
  Worker invocation per minute and no second schedule to keep alive.
- The tick runs the job executor directly, not through the Next.js handler (`src/lib/cron.ts`),
  whether the VPS or the Cron Trigger starts it.
- The OSM index is the opposite case: it changes weekly and is heavy, so the VPS builds it (and a
  free GitHub runner builds the static fallback). `cloudflare/scripts/build-place-shards.ts` warns
  when the fallback's file count nears the plan's 20,000-asset limit (16,437 index files plus the
  app).
- Place search on the VPS takes the CPU-heavy scoring off the Worker: a search costs the Worker a
  `fetch` (I/O time is not CPU time) and repeated queries are answered from the edge cache.

## Free-plan limits that matter here

| Resource           | Free limit                                                                                       | Use today                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| D1 rows read       | 5 million/day ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/))             | was 41.8M in 7 days (fixed, see below); expect thousands/day                        |
| D1 rows written    | 100,000/day (an indexed insert counts the index rows too)                                        | ~150 heartbeat rows/day plus real bookings                                          |
| Worker requests    | 100,000/day (static assets are free and not counted)                                             | `/api/*` calls plus 1,440 cron runs                                                 |
| CPU per invocation | 10 ms, HTTP and Cron alike ([limits](https://developers.cloudflare.com/workers/platform/limits)) | cron ticks measured at 27 to 63 ms while D1 was refusing queries (see "Unverified") |
| Worker size        | 3 MB gzipped                                                                                     | 1.5 MiB gzipped (8.7 MiB raw), _measured_                                           |
| Static assets      | 20,000 files per version                                                                         | ~16.6k (place index 16,437 + app)                                                   |
| Durable Objects    | SQLite-backed only; 100,000 requests/day, duration billed only while awake                       | hibernation on both hubs                                                            |
| TURN relay (calls) | 1,000 GB/month shared with SFU ([pricing](https://developers.cloudflare.com/realtime/pricing/))  | relays only when the direct path fails (~22 MB per call hour)                       |

When a Free limit is exceeded the operation fails until the next reset (00:00 UTC), it is not
billed. That is exactly what happened on 2026-10-28: D1 refused reads and `/api/routes` answered 500.

## Incident 2026-10-28: D1 read quota

`wrangler d1 insights DB --time-period 7d --sort-type sum --sort-by reads` showed 41.8M rows read,
99.97% from two queries the every-minute tick ran: a `DELETE FROM job_run WHERE created_at < ?`
after every job run (no index starts with `created_at`, so a full scan per minute) and the
`trips.warm` gate (sorted every run of that type). Fixed in #105: no pruning on the hot path (the
daily `jobs.retention` job does it), the gate reads through the `(job_type, created_at)` index,
an idle sweep writes one heartbeat per 10 minutes, and the admin job list uses indexed lookups.

**Rule for anything that runs on the tick:** it may only touch rows through an index and must not
write when it has nothing to do. `tests/integration/jobs-claim.test.ts` pins both.

## Checking the budget

```bash
cd cloudflare
# Heaviest queries over the last day by rows read (top entries should be single-digit thousands)
bunx wrangler d1 insights DB --time-period 1d --sort-type sum --sort-by reads --limit 10
# Same by rows written
bunx wrangler d1 insights DB --time-period 1d --sort-type sum --sort-by writes --limit 10
# Live cron ticks (outcome, cpuTime, wallTime)
bunx wrangler tail datxevui --format json
```

A tick that shows `"outcome": "exceededCpu"` means the 10 ms limit is being enforced on cron
invocations; the fix is then to raise the interval, not to remove work.

## Unverified

- **Cron CPU on healthy ticks.** The two ticks captured after the fix ran while D1 was refusing
  queries (27 and 63 ms CPU, outcome `exception`, not `exceededCpu`). Re-measure with
  `wrangler tail` once D1 answers.

## Not done (dashboard-only)

- Cloudflare **Workers Builds** is also connected to the repository and builds every push in
  parallel with the GitHub Actions deploy; its check fails on pull requests. Pick one deploy path
  (Actions is the documented one) and disconnect the other under Workers & Pages, datxevui,
  Settings, Builds.
- The WAF rate-limit rule and Bot Fight Mode from `README-CLOUDFLARE.md`.
