# deploy/vps — the Rust binary under systemd on the OVH VPS

One process, `datxevui`, serves the API, the SPA and the WebSockets on
`127.0.0.1:8080`. Cloudflare stays DNS, proxy and the `cloudflared` tunnel
(outbound only): no Caddy, no Docker, and ufw stays SSH-only. The box is
shared with the k3s agent, the 256Mi quiz pod and `cloudflared`, so
everything below is sized for 4 GB of RAM. (`deploy/stack.yml`, the Swarm
stack, is for other hosts; this one does not use it.)

| File | Installed as | Job |
|---|---|---|
| `datxevui.service` | `/etc/systemd/system/` | The app: dedicated user, sandboxed, `MemoryHigh=1400M` / `MemoryMax=1900M` (headroom for the place build, see below), restarts on failure. |
| `datxevui-backup.service` + `.timer` | same | Every 6 h: `VACUUM INTO` a snapshot, integrity check, gzip, prune, upload to S3. |
| `datxevui-update.service` + `.timer` | same | Every 5 min: install the newest signed release, if any. |
| `backup.sh` | `/usr/local/sbin/datxevui-backup` | What the backup unit runs (`--local-only` skips the upload). |
| `update.sh` | `/usr/local/sbin/datxevui-update` | Signed-release pull, swap, health check, rollback. |
| `bootstrap.sh` | run once from a checkout | User, directories, packages, units, firewall check, swap check. Safe to repeat. |
| `env.example` | `/etc/datxevui/env` | Secrets and per-site values; installed once, never overwritten. |
| `cloudflared-ingress.yml` | example only | Tunnel hostnames -> `http://127.0.0.1:8080`. |

## First install

```bash
# on the VPS, from a checkout of this repository
sudo bash deploy/vps/bootstrap.sh
sudoedit /etc/datxevui/env          # JWT_SECRET etc.; docs/CUTOVER.md has the checklist
sudo datxevui-update auto           # installs the newest release and enables the timers
journalctl -u datxevui -f
```

`bootstrap.sh` refuses to continue if something else already listens on
8080 (check `ss -ltnup` first), installs `sqlite3` and `rclone`, and sets the
host timezone to Asia/Ho_Chi_Minh (the systemd timers use host time; the
app's own jobs use `SCHEDULER_TZ_OFFSET_MINUTES`, default UTC+7; check with
`timedatectl` and `systemctl list-timers 'datxevui-*'`). It never opens a
port and leaves k3s's firewall rules alone.

## Layout on the box

```
/opt/datxevui/releases/<tag>/   datxevui (binary), dist/ (SPA), deploy/
/opt/datxevui/current           symlink to the active release
/etc/datxevui/env               root:datxevui 0640
/var/lib/datxevui/              app.db (+ -wal/-shm), uploads/, places/, backups/, legacy-next/
/var/lib/datxevui-update/       installed / failed markers
```

`/var/lib/datxevui` is the unit's `StateDirectory`: the only place the
service can write. Releases are root-owned and read-only to it.

## Releases

`git tag vX.Y.Z && git push origin vX.Y.Z` runs
`.github/workflows/release-vps.yml`, which takes the tag all the way to a
verified production deploy:

1. **test**: `cargo fmt --check`, `cargo test --workspace`, frontend
   typecheck, lint and tests, on the tagged commit. Red stops the release.
2. **build and sign**: release binary (built with `RELEASE_TAG` and
   `RELEASE_COMMIT`, so `GET /ready` reports the tag as `version`) +
   `frontend/dist` + the legacy `_next/static` (when a `legacy-next`
   prerelease exists) + these files, one tarball, SHA-256 and an
   `ssh-keygen -Y` signature in namespace `datxevui-release`. `update.sh`
   pins the public key; the secret `RELEASE_SIGNING_KEY` is its private half.
3. **publish**: the GitHub release.
4. **install on the VPS**: nothing is pushed to the box.
   `datxevui-update.timer` finds the new release within 5 minutes and runs
   `update.sh` (below).
5. **verify-deploy**: `verify-release.sh` polls `https://datxevui.com/ready`
   every 20 s for up to 15 minutes until `version` equals the tag. A red job
   means the VPS did not install the release or rolled it back: run
   `journalctl -u datxevui-update -n 100` there. A suffixed tag
   (`v1.2.0-rc1`) is a prerelease: built and published, never installed by
   the box, so this step is skipped.

To rotate the key, publish one release signed with the old key whose
`update.sh` pins the new public key; the box installs it, and every later
release must be signed with the new key.

On each update `update.sh`:

1. downloads, checks SHA-256 and signature (refuses on any mismatch);
2. takes a local database snapshot (a failed snapshot aborts the update);
3. carries the hashed `assets/` each of the last three releases shipped (and
   of every release younger than 48 h, whichever is more) into the new
   `dist/`, so tabs opened before the swap, and pages the edge cache still
   holds, can load their chunks; a file that falls out of that window is not
   carried on, so `dist/` stays bounded (`bash deploy/vps/test-update-assets.sh`
   proves the carry-over and the pruning on fake releases);
4. flips `current`, refreshes units and scripts from the release, restarts;
5. requires `GET /ready` to answer 200 within 90 s, else flips back, marks
   the tag failed (never retried) and restarts the previous release.

Migrations run when the new binary starts and are not undone by a rollback.
If the old binary rejects a migrated database, restore the snapshot taken in
step 2 (below). Install or roll back a specific tag by hand with
`sudo datxevui-update v1.2.0`; an installed or failed tag is retried only
when named explicitly. The three newest releases are kept, plus any younger
than 48 h, at most ten; the active and the previous release always stay.

## The place index

The index is rebuilt by the `places.build` job inside `datxevui`, not by a
systemd timer: weekly, Mondays 03:30 (`SCHEDULER_TZ_OFFSET_MINUTES`, UTC+7 by
default). Admin -> Cron jobs shows each run (status, started, duration, the
generation published or "unchanged: extract md5 matches"), edits the
schedule and has "Run now". Run it once after the first install: until a
generation exists, place search answers `engine: "unavailable"`.

The job never extracts in the server process. It runs `datxevui places-build`
as a child of the server (niced to 19, idle I/O, `oom_score_adj` 1000, one
hour at most, one build at a time through `places/.lock`), so the extraction's
memory is charged to `datxevui.service`'s cgroup (limits above) and the
kernel kills the child first under memory pressure. The app picks up the
new generation within a minute; no restart.

`datxevui places-build [--force]` is the same build by hand, for diagnosis:
log lines on stderr, one JSON summary line on stdout, exit status 1 on
failure. It is not limited by the unit's cgroup, so it is niced here:

```bash
sudo -u datxevui bash -c 'set -a; . /etc/datxevui/env; set +a
  SERVER_HOST=127.0.0.1 SERVER_PORT=8080 PLACES_DIR=/var/lib/datxevui/places \
  DATABASE_URL="sqlite:///var/lib/datxevui/app.db?mode=rwc" \
  nice -n 19 /opt/datxevui/current/datxevui places-build --force'
```

It refuses to start while the job's build runs (`places/.lock`).
`PLACES_DIR`, `PLACES_PROFILE` and `SEARCH_OSM_DOWNLOAD_URL` apply to both.

## Rolling back the place index

`places/current` is a symlink to `gen-<timestamp>`; the two newest
generations are kept. A bad generation is undone by pointing the link back,
atomically (the app notices within a minute, no restart):

```bash
cd /var/lib/datxevui/places
ls -d gen-*                                   # newest last; pick the old one
sudo -u datxevui ln -sfn gen-<old> current.new && sudo -u datxevui mv -T current.new current
```

`places-build` fsyncs the generation directory and the parent directory
after both renames, so a power cut cannot leave `current` pointing at a
generation that was not durably written.

## Backups

`datxevui-backup` writes `app-<UTC stamp>.db.gz` into
`/var/lib/datxevui/backups` (newest `BACKUP_KEEP_LOCAL` kept) and, when
`BACKUP_S3_BUCKET` is set, copies it to `s3://<bucket>/<prefix>/db/`, adds
new `uploads/` files to `s3://<bucket>/<prefix>/uploads/` (never deletes
there) and removes remote archives older than `BACKUP_KEEP_REMOTE_DAYS`. Any
S3-compatible endpoint works (RustFS, MinIO, R2, B2); the keys come from the
environment, never a command line. `deploy/backup.sh` (Swarm) has no upload
step to mirror, so this is the only one.

`VACUUM INTO` is a single read transaction: consistent while the site keeps
writing, and the snapshot has no WAL. The app itself checkpoints the WAL
(PASSIVE every 60 s, TRUNCATE nightly at 04:00); nothing here does.

Health: `/var/lib/datxevui/backups/.last-ok` (last local success) and
`.last-upload-ok`; a failed run leaves `datxevui-backup.service` in the
failed state (`systemctl list-units --failed`).

Restore:

```bash
sudo systemctl stop datxevui
gunzip -c /var/lib/datxevui/backups/app-<stamp>.db.gz | sudo -u datxevui tee /var/lib/datxevui/app.db >/dev/null
sudo rm -f /var/lib/datxevui/app.db-wal /var/lib/datxevui/app.db-shm
sudo systemctl start datxevui
```

## Edge caching of the pages (Cloudflare)

The pages are the same for every visitor (no per-user markup, no cookies), so
the app marks them for the edge. Without a cache rule Cloudflare passes every
HTML request to the origin (`cf-cache-status: DYNAMIC`, 180-215 ms from
Vietnam, almost all network).

What the app sends:

| Response | `Cache-Control` | Also |
|---|---|---|
| public pages: `/`, `/search` (any query), `/compare`, `/privacy`, `/terms`, `/brands/<slug>`, `/trips/<id>` | `public, max-age=0, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400` | `ETag` (weak) and `304` on `If-None-Match`, `Vary: Accept-Encoding` only, `Link: rel=preload` headers (fonts, stylesheet, home hero photo) |
| private pages (`/login`, `/admin*`, `/account*`, `/bookings/*`, `/payments/*`), 404s, a page the database could not fill | `no-cache, must-revalidate` | no `ETag` |
| `/assets/*` (content-hashed) | `public, max-age=31536000, immutable` | `.br` / `.gz` twins served as they are |
| fonts, icons, hero photos, logo | `public, max-age=86400, stale-while-revalidate=604800` | |
| `/api/*` | its own (60 s for anonymous public reads, `no-store` with a session) | |

A response that sets a cookie is never marked for the edge (the app rewrites it
to `no-store`), and the CORS layer's `Vary: Origin` is replaced by
`Vary: Accept-Encoding` on cacheable pages.

**The rule to create in the dashboard** (the app cannot do this itself):
Caching -> Cache Rules -> Create rule, in this order:

1. *Bypass the private areas.* If **Hostname equals `datxevui.com`** and
   (**URI Path starts with `/admin`** or `/account` or `/console` or
   `/payments` or `/bookings` or `/login` or `/api` or `/ws`), then
   **Bypass cache**. (Edge cache never sees these; the origin already sends
   `no-cache`, this is the second lock.)
2. *Cache the pages.* If **Hostname equals `datxevui.com`** and **Request
   Method equals GET**, then **Eligible for cache**, **Edge TTL: Use
   cache-control header if present, bypass cache if not**, **Browser TTL:
   Respect origin**. Leave "Serve stale content while revalidating" on. No
   cookie condition is needed: the pages hold nothing per user, so a signed-in
   visitor is served the same cached page (the private areas are rule 1's, by
   path, whatever cookie they carry).

Rule 2 caches the HTML pages *and* the hashed assets with the origin's own
lifetimes; no TTL is set in the dashboard, so a header change in the app is
all it takes to change what is kept. The anonymous public reads of the API are
`public, max-age=60` and, being under `/api`, stay out of the cache by rule 1
until someone decides to cache them (drop `/api` from rule 1 and they are
cached for 60 s).

**Deploys.** A page cached at the edge names the previous release's hashed
files for up to five minutes, an hour more while `stale-while-revalidate`
refreshes it, and a day more only if the origin is failing (`stale-if-error`).
`update.sh` carries the assets of the last three releases (and everything
younger than 48 h) into each new release, so such a page keeps working for far
longer than the edge keeps it. After a release that changes the shell's
structure you can still purge at once: Caching -> Configuration -> Purge Cache
-> Purge Everything (or purge by URL for `/`).

**Cache key.** The page does not depend on `utm_*`, `fbclid`, `gclid`, `gbraid`
or `wbraid`, so a campaign link must not get a copy of its own. In rule 2 set
Cache key -> Query string -> **Exclude** `utm_source`, `utm_medium`,
`utm_campaign`, `utm_term`, `utm_content`, `fbclid`, `gclid`, `gbraid`,
`wbraid` (`from`, `to`, `date` and the rest stay in the key: they change the
page). The app keeps the click ids itself, in a script that runs before the
first navigation.

**Early Hints.** Caching -> Configuration -> Early Hints: On. Cloudflare reads
the `Link: rel=preload` headers of the cached page and sends them as a `103`
before the body, so the browser starts on the stylesheet, the two fonts and
(on `/`) the hero photo while the page is still on its way. The app's scripts
are not preloaded here: they are an ordinary module script of the page (see
`docs/PERFORMANCE.md`).

**Check** (from anywhere, twice; the second answer should be `HIT`):

```bash
curl -s -o /dev/null -D - https://datxevui.com/ -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) Chrome/130' \
  | grep -iE '^(cf-cache-status|cache-control|etag|age|link|vary)'
```

## Memory budget (4 GB, 1 GB swap)

| Consumer | Steady | Limit |
|---|---|---|
| k3s agent | ~350 MB | none |
| quiz pod | <= 256 MB | pod limit |
| cloudflared | ~40 MB | none |
| datxevui | ~330 MB | high 1400M, max 1900M |
| place build (Mon 03:30), a child of datxevui | 665 MB peak (debug, macOS; Linux release not yet measured) | inside datxevui's limits, killed first |

Peak figures: the place build's is a debug build on macOS; the cutover gate
in `docs/CUTOVER.md` replaces it with a Linux release measurement and the
limits follow it. The build is charged to the app's cgroup (it is its child),
so `MemoryHigh` leaves room for ~330 MB + ~665 MB + ~265 MB while a new index
is swapped in; the build runs at idle priority in the quietest hour and is
the first thing the OOM killer takes.
Hardening notes: no syscall filter or `MemoryDenyWriteExecute` is set because
neither could be tested without the box; add them after the staging soak
guided by `systemd-analyze security datxevui`.

## Checks

```bash
systemctl status datxevui datxevui-update.timer datxevui-backup.timer
curl -s http://127.0.0.1:8080/ready
systemctl list-timers 'datxevui-*'
# build a place index now: admin -> Cron jobs -> places.build -> Run now
sudo systemctl start datxevui-backup.service     # back up now
```
