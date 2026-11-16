# Cutover runbook: Cloudflare Worker -> the Rust binary on the VPS

Moves `datxevui.com` and `www.datxevui.com` from the Worker (D1, R2, KV,
Durable Objects) to `datxevui.service` on the OVH VPS, reached through the
existing `datxevui-vps` Cloudflare Tunnel. Cloudflare stays DNS, proxy and
tunnel. Unit files, the update flow and the box layout are in
[`deploy/vps/`](../deploy/vps/README.md); the import tool is
`datxevui import-d1`, with `scripts/d1-export.sh` and `scripts/r2-sync.sh`
around it.

Plan: one night (T-0 = 01:00 ICT), about 30 minutes without writes. Rollback
is allowed until T+2h; after that, fix forward.

## What users will notice (accepted)

- Writes fail with 503 for about 30 minutes (reads keep working).
- Calls in progress drop and chats reconnect: Durable Object state is not
  migrated. This is why the cutover runs at night.
- Access tokens revoked in the last 15 minutes (the KV revocation list is not
  migrated) become valid again until they expire.
- In-process caches start empty, so the first requests after the start are
  slower.
- Anyone with the old app shell cached (service worker) keeps working: the
  binary serves the final Worker build's `/_next/static` for 30 days, and the
  new `sw.js` (`VERSION = v3`) replaces the old shell on the next visit.

## Secrets checklist (do this first, not at T-0)

Wrangler secrets cannot be read back. Each one must come from wherever the
owner stored it; a missing one is a feature outage. Put them in
`/etc/datxevui/env` on the VPS (root:datxevui 0640), never in git or chat.

| Secret | Without it |
|---|---|
| `JWT_SECRET` (and `JWT_ISSUER`) | Every web and mobile session ends (the refresh-token HMAC is keyed by it); 90-day mobile sessions included. Must be 32+ bytes. |
| OAuth client secrets (Google, Facebook) and `OAUTH_REDIRECT_BASE_URL` / `OAUTH_FRONTEND_URL` | Social login fails. Provider consoles must list the redirect URL the binary uses. |
| Push: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_KEY_PEM`, `FCM_CREDENTIALS_JSON` | Incoming calls and notifications do not wake phones. |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` with `AUDIO_CALL_TURN_AUTH_MODE=cloudflare` | Calls lose their relay (corporate and HTTPS-only networks). |
| Google Ads: customer, developer token, OAuth client and refresh token | Conversion uploads stop. |
| VietQR account (`VIETQR_*`) | No payment instructions on bookings. |
| Backup target `BACKUP_S3_*` | Backups stay on the VPS disk only. |

`MOMO_ENABLED`, `ZALOPAY_ENABLED` and `VNPAY_ENABLED` stay `false`, as in the
Worker; `VIETQR_ENABLED=true`, `PAYMENT_COD_ENABLED=true`.

If `JWT_SECRET` is lost, decide now to accept a global sign-out and announce
it; there is no way to recover it afterwards.

## Before T-0

T-7d to T-2d:

1. Install the VPS: `deploy/vps/README.md` (bootstrap, env file, first
   `datxevui-update auto`). Check `free -m` (2 GB or 4 GB; the unit limits
   assume 2 GB) and that nothing else holds 8080.
2. Add the tunnel hostnames from `deploy/vps/cloudflared-ingress.yml`:
   `staging.datxevui.com` first, protected by a Cloudflare Access policy;
   `datxevui.com` and `www.datxevui.com` can already be in the ingress file
   (they receive no traffic until DNS points at the tunnel). Restart
   `cloudflared`.
3. Nightly: import a fresh D1 export into the staging database and read the
   report (below). Run the parity harness against `staging.datxevui.com`.
4. 24 h soak on staging: `systemctl status datxevui` memory stays under
   `MemoryHigh`, no 5xx, `datxevui-places.service` completes inside its
   1200M cap (see the memory gate below), `datxevui-backup.timer` produces
   archives and uploads them.
   Restore one backup into a scratch file and compare table counts.
5. Memory gate: run `sudo systemctl start datxevui-places.service` on the
   VPS with the release build and read the peak
   (`systemctl show datxevui-places -p MemoryPeak`, or `/usr/bin/time -v`
   around `datxevui places-build --force`). The only figure so far is 665 MB
   from a debug build on macOS. The unit allows 1200M (high 1000M); if the
   Linux release peak exceeds 900M, raise the caps and re-check the memory
   table in `deploy/vps/README.md` against free RAM (~2.7 GB available).
   Do not cut over before this number is recorded.
6. Rehearse the rollback once.
7. Confirm in the Cloudflare dashboard that no "Cache Everything" rule exists
   for the zone (it would cache cookie-bearing HTML) and that no page rule
   or cache rule matches `/api/*`.
8. Publish the legacy assets once (see the header of
   `.github/workflows/release-vps.yml`), then tag the release that is going
   live, so the box already runs it and serves `/_next/static`. The tag does
   the rest from GitHub: tests, build, signature, release, and (within 5
   minutes) the box's own install; the workflow's last job turns red unless
   `https://datxevui.com/ready` reports the tag in its `version` field (a
   red job: read `journalctl -u datxevui-update` on the box).

T-1d:

1. Check the secrets table above is complete in `/etc/datxevui/env`.
2. Pre-sync objects: `scripts/r2-sync.sh` (the equivalent of
   `rclone copy r2:datxevui-uploads /var/lib/datxevui/uploads`, same keys).
   It runs again at T-0 for the delta only.
3. Build a place index now: `sudo systemctl start datxevui-places.service`;
   `/var/lib/datxevui/places/current` must point at a `gen-*` directory.
   Until a generation exists, place search answers `engine: "unavailable"`.
4. Prepare, but do not enable, the freeze rule (T-0, step 1). Make sure the
   Cloudflare API token for `wrangler` works and you can edit the Worker's
   domains and triggers.
5. Tell staff the date, the write freeze and the sign-in to expect.
6. Check `ufw status` shows SSH only, and `cloudflared` is healthy on the VPS.

## T-0 (01:00 ICT)

Keep two terminals open: the VPS and a laptop with `wrangler` logged in.

1. **Freeze writes.** In the zone, add a WAF custom rule that blocks with a
   503 response, for hosts `datxevui.com` and `www.datxevui.com`:
   - non-`GET`/`HEAD`/`OPTIONS` requests with a path starting `/api/`, and
   - any request to `/ws` or `/ws-call` (chat and call hubs write to D1).
   Check: `curl -si -X POST https://datxevui.com/api/auth/logout` returns 503
   and a page load still works.
2. **Stop the other writers.** Remove the cron trigger from the Worker
   (`triggers.crons`, redeploy or dashboard: Workers > datxevui > Settings >
   Triggers) and on the VPS `sudo systemctl disable --now vps-service` (it is
   replaced; its place search and scheduler now live in the binary).
3. **Final export and object delta.** `scripts/d1-export.sh` (per table with
   `wrangler d1 export --remote --table ...` into `stage.db`, because D1
   refuses databases that contain virtual tables), then `scripts/r2-sync.sh`.
   Copy `stage.db` and the script logs to `/var/lib/datxevui/import/` on the
   VPS. Keep `d1.sql`/`stage.db` until T+30d.
4. **Import.** Stop the app and set the staging database aside, then import
   into a fresh `app.db`:
   ```bash
   sudo systemctl stop datxevui
   cd /var/lib/datxevui
   sudo mkdir -p import-old && sudo mv app.db app.db-wal app.db-shm import-old/ 2>/dev/null || true
   sudo systemd-run --wait --pty --uid=datxevui --gid=datxevui \
     --property=EnvironmentFile=/etc/datxevui/env --property=MemoryMax=1G \
     /opt/datxevui/current/datxevui import-d1 \
       --stage /var/lib/datxevui/import/stage.db \
       --out /var/lib/datxevui/app.db \
       --report /var/lib/datxevui/import/report.json
   ```
   Go only if the report shows: `integrity_check` ok, `foreign_key_check`
   empty, per-table counts equal to the D1 export, every entity decoded, no
   unparseable timestamps or ids, and no unexplained UNIQUE or foreign-key
   difference. Any failure: stop, leave the freeze in place, and either fix
   and rerun or abort (rollback below; nothing has changed on D1 yet).
5. **Start and verify on staging.** `sudo systemctl start datxevui`, then
   `curl -s http://127.0.0.1:8080/ready` returns 200 and the log shows
   migrations applied. Through `https://staging.datxevui.com`: the smoke
   checks below (everything except mobile).
6. **Move the domains.** In order:
   1. Delete the custom domains `datxevui.com` and `www.datxevui.com` from the
      Worker (`wrangler.jsonc` `routes` and the dashboard). This removes their
      DNS records.
   2. Create the tunnel DNS routes straight away:
      `cloudflared tunnel route dns datxevui-vps datxevui.com` and the same
      for `www.datxevui.com` (or the dashboard's Public hostnames). Both must
      be proxied (orange cloud).
   3. Optionally add a 301 redirect rule `www` -> apex.
   Downtime for reads is the gap between 1 and 2: seconds.
7. **Remove the freeze rule.** It applies to the zone, so it would now block
   the new origin too.
8. **Smoke-test production and mobile** (below). Announce the go-live to staff.
   Note the time: rollback closes at T+2h.

## Smoke checks

Production unless stated. Use a browser User-Agent for scripts; the
anti-scraping layer blocks bare script UAs.

- `curl -s https://datxevui.com/ready` and `/health`: 200.
- Home page renders; an unknown path gives a 404 status with the SPA; `/foo/`
  redirects to `/foo` with 308; `sitemap.xml` lists the active brands and
  corridors; `robots.txt` and `ads.txt` answer.
- Customer login with a migrated PBKDF2 account (the row becomes Argon2 on
  success), staff login, a Google login, logout.
- Search a route and date, open a trip, hold a seat on a test trip, see the
  VietQR step, release the hold (or cancel), as a customer and in the admin.
- Admin: open the system page (memory, database, place-index cards), edit a
  brand, upload a route picture and see it served from `/api/media` or
  `/uploads`.
- An existing route picture and a brand logo load (the R2 objects).
- Place search (`/api/places/search?q=hue`) returns hits with
  `engine: "index"`.
- Chat: open the widget, send a message, see it on the staff side. Call:
  place a call between two devices, confirm audio and that TURN credentials
  are minted (the call-hub script from the parity harness also covers this).
- A cached old shell: in a browser that has the Worker-era site, reload and
  confirm no blank page; `https://datxevui.com/_next/static/<a file from
  legacy-next>` returns 200.
- Mobile app (real device, same build as in the stores): the existing session
  keeps working without a new login, a push-woken call rings with the caller
  id, a booking can be viewed.
- Rate limits are per visitor: two different networks do not share a bucket
  (the log shows `CF-Connecting-IP` addresses, not 127.0.0.1).
- Logs: `journalctl -u datxevui -n 200 --no-pager` has no repeated errors.

## Rollback (only until T+2h)

When: a smoke check that matters fails and cannot be fixed in minutes.

1. Re-apply the freeze rule (so nothing else is written to either side), then
   export what was created on the VPS since the flip for hand re-entry:
   admin bookings export (`GET /api/admin/bookings/export` as an admin) and
   the audit log. Expect a handful at night.
2. Delete the tunnel DNS records for `datxevui.com` and `www`, re-create the
   Worker custom domains (`routes`), restore the cron trigger, and
   `sudo systemctl enable --now vps-service` on the VPS. D1 and R2 were never
   changed after the freeze, so the Worker is exactly as it was.
3. `sudo systemctl stop datxevui` (keep `/var/lib/datxevui/app.db` for the
   re-entry), remove the freeze rule, run the smoke checks against the Worker.
4. Re-enter the Rust-era bookings, users and messages by hand from the exports.

After T+2h there is no path back to D1: fix forward (hotfix tag, restore from
`/var/lib/datxevui/backups`, or the S3 copy).

## After cutover

- Keep the Worker, D1 and R2 for 30 days as a read-only snapshot: no custom
  domains, cron removed, `workers.dev` disabled; delete the R2 write tokens;
  keep a copy of the final `stage.db`/export in the backup bucket. Calendar
  the deletion date (T+30d).
- At T+30d: delete the Worker, the D1 database, the R2 bucket and the KV
  namespace; remove the Workers VPC binding, the `vps-service` tunnel
  ingress and the `legacy-next` release; delete `/var/lib/datxevui/legacy-next`
  and `/var/lib/datxevui/import-old`.
- Ship the next release without the legacy assets after T+30d.

## T+24h checks

- `systemctl status datxevui`: running without restarts; memory under
  `MemoryHigh` (900M); swap not growing (`free -m`).
- `journalctl -u datxevui --since yesterday -p warning` reviewed; Cloudflare
  analytics: 4xx/5xx rate and cache status in line with the week before.
- Backups: four archives in `/var/lib/datxevui/backups`, `.last-upload-ok`
  fresh, the newest object present in the bucket; restore one into a scratch
  file and compare counts.
- `systemctl list-timers 'datxevui-*'`: places (next Monday 03:30), backup,
  update all scheduled; `/var/lib/datxevui/places/current` valid.
- Disk: `df -h /var/lib/datxevui`; WAL file not growing unbounded (nightly
  TRUNCATE ran at 04:00).
- Search Console: fetch `sitemap.xml`, inspect the home page and one corridor
  page for the canonical and robots result; no coverage drop in the first
  report.
- Mobile: crash reporting and push delivery normal; no spike in 401s on
  `/api/auth/refresh`.
- Staff confirm bookings and chat in the admin console.
