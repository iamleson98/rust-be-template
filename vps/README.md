# vps-service

One Rust binary on a small VPS (OVH, 2 vCPU / 4 GB) that does the three jobs
the Cloudflare Workers Free plan cannot do well:

| Job | How |
| --- | --- |
| **Place search** | Every named place in Vietnam from OpenStreetMap (~325k after merging duplicates) in an in-memory index: tone-free and toned Vietnamese, words typed together ("hanoi", "benxemydinh"), short forms ("hcm", "bx", "q1"), typos ("nguyne"), type words ("bến xe", "ga", "phường") that set what kind of place is wanted, address context ("trần phú nha trang"), and an optional bias toward a point. 0.1–12 ms per query. |
| **OSM indexer** | Weekly: checks Geofabrik's MD5 (no download when unchanged), downloads the extract, extracts places in a low-priority child process, validates, swaps the new index in, deletes everything it no longer needs. |
| **Cron driver** | Calls the Worker's job executor (`POST /api/jobs/tick`: seat-hold sweep, campaign coupon expiry, trip warming, retention) every minute, with retries. The Worker's own Cron Trigger only steps in when these ticks stop. |

The Worker reaches it through Cloudflare Tunnel; the service itself listens
on `127.0.0.1` only. When the VPS is down the site keeps working: place
search falls back to the static index shipped with the Worker, and the cron
trigger takes over within 7 minutes.

## Measured (Vietnam extract, 332 MB, Oct 2026)

| | |
| --- | --- |
| Index run, end to end | ~48 s wall; extractor ~42 s of one core at nice 19 + idle I/O |
| Extractor child peak memory | ~610 MB, returned to the OS when it exits |
| Server while building the new index | ~480 MB for ~2 s (old index keeps serving), then back down |
| Server steady state | ~235 MB resident |
| On disk | the live index (~40 MB) + one previous generation; the OSM download and all scratch files are deleted after every run |
| Unchanged extract | one 60-byte request to Geofabrik, nothing else |

## API

All `/v1/*` routes need `Authorization: Bearer $VPS_SERVICE_TOKEN`.

| Route | Answer |
| --- | --- |
| `GET /healthz` | 200 `{status, places, indexBuiltAt}` with a live index, 503 before (no auth) |
| `GET /v1/places/search?q=&limit=&lat=&lon=` | `{items, engine}`; blank `q` lists popular places |
| `GET /v1/places/reverse?lat=&lon=&limit=` | nearest areas, nearest first |
| `GET /v1/places/popular?offset=&limit=` | biggest cities and towns |
| `GET /v1/status` | CPU, memory, disk, load, search latency percentiles, index state and last run, cron jobs |
| `POST /v1/index?force=true` | start an index run now (202), or 409 while one runs |

Hits have the shape of the Worker's `/api/places/*` routes:
`{id, name, nameNoTones, type, province, district, ward, lat, lon, score}`.

## Set up a new VPS

1. **OVH**: Ubuntu 24.04, Singapore (closest to Vietnam). Log in with an SSH
   key, then:

   ```bash
   sudo apt update && sudo apt -y upgrade && sudo apt -y install unattended-upgrades ufw curl
   sudo ufw allow OpenSSH && sudo ufw enable        # nothing else is opened
   sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
   sudo systemctl restart ssh
   ```

2. **Install the service** (latest build from the `vps-service` release):

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/iamleson98/rust-be-template/HEAD/vps/deploy/update.sh
   sudo bash update.sh
   ```

   It creates the `vps-service` user, `/etc/vps-service/config.toml` and
   `/etc/vps-service/env` with a random `VPS_SERVICE_TOKEN`. Put the Worker's
   `CRON_SERVICE_TOKEN` into `/etc/vps-service/env`, then
   `sudo systemctl restart vps-service`. The first start builds the index
   (about a minute); `journalctl -u vps-service -f` shows it.

3. **Cloudflare Tunnel** (no open ports):

   ```bash
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared noble main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt update && sudo apt -y install cloudflared
   cloudflared tunnel login                     # pick datxevui.com
   cloudflared tunnel create vps                # prints the tunnel id
   sudo mkdir -p /etc/cloudflared && sudo cp ~/.cloudflared/<TUNNEL_ID>.json /etc/cloudflared/
   # vps/deploy/cloudflared-config.yml → /etc/cloudflared/config.yml (fill in the id)
   cloudflared tunnel route dns vps vps.datxevui.com
   sudo cloudflared service install
   curl https://vps.datxevui.com/healthz
   ```

4. **Worker**: `VPS_URL` is already `https://vps.datxevui.com` in
   `cloudflare/wrangler.jsonc`; add the token as a secret:

   ```bash
   cd cloudflare && bunx wrangler secret put VPS_SERVICE_TOKEN   # value from /etc/vps-service/env
   ```

   Until the secret is set the Worker keeps using the static index and its
   own cron trigger. `/admin/system` shows which engine and driver are live.

## Operate

```bash
journalctl -u vps-service -f                          # logs (index runs, failed jobs)
sudo bash update.sh                                    # update to the latest build (rolls back if it fails to start)
source /etc/vps-service/env
curl -s -H "Authorization: Bearer $VPS_SERVICE_TOKEN" localhost:8787/v1/status | jq .index
curl -s -X POST -H "Authorization: Bearer $VPS_SERVICE_TOKEN" "localhost:8787/v1/index?force=true"
sudo -u vps-service vps-service query --config /etc/vps-service/config.toml   # try queries in a terminal
```

Schedules, the extract URL, the extractor profile and the safety limits
(`min_places`, `max_shrink`, `keep_generations`) are in
`/etc/vps-service/config.toml` (see `config.example.toml`). A new index is
published only when it has at least `min_places`, lost at most `max_shrink`
of the live one, and answers the smoke queries (big cities, the main bus
stations and airports); otherwise the live index keeps serving and
`/v1/status` shows why.

## Develop

```bash
cd vps
cargo test                       # engine, indexer, store, scheduler, HTTP
cargo clippy --all-targets -- -D warnings
# Real data: index the Vietnam extract into ./data and search it
printf '[server]\ndata_dir = "data"\n[indexer]\n' > dev.toml
curl -fsSL -o vn.osm.pbf https://download.geofabrik.de/asia/vietnam-latest.osm.pbf
VPS_SERVICE_TOKEN=dev-token-dev-token-dev-token cargo run --release -- index --config dev.toml --pbf vn.osm.pbf
cargo run --release -- query --config dev.toml
```

The extraction code is `tools/place-extract` (a library here, and the CLI
the weekly `place-index.yml` job uses for the Worker's static fallback).
Province names map onto `cloudflare/src/lib/cities.json`, the app's own list.
