# vps-service

One Rust binary on a small VPS (OVH, 2 vCPU / 4 GB) that does the three jobs
the Cloudflare Workers Free plan cannot do well:

| Job | How |
| --- | --- |
| **Place search** | Every named place in Vietnam from OpenStreetMap (~325k after merging duplicates) in an in-memory index: tone-free and toned Vietnamese, words typed together ("hanoi", "benxemydinh"), short forms ("hcm", "bx", "q1"), typos ("nguyne"), type words ("bến xe", "ga", "phường") that set what kind of place is wanted, address context ("trần phú nha trang"), and an optional bias toward a point. 0.1–12 ms per query. |
| **OSM indexer** | Weekly: checks Geofabrik's MD5 (no download when unchanged), downloads the extract, extracts places in a low-priority child process, validates, swaps the new index in, deletes everything it no longer needs. |
| **Cron driver** | Calls the Worker's job executor (`POST /api/jobs/tick`: seat-hold sweep, campaign coupon expiry, trip warming, retention) every minute, with retries. The Worker's own Cron Trigger only steps in when these ticks stop. |

Nothing on the internet can reach the service: it listens on `127.0.0.1`
and the Worker reaches it privately (see "Security"). When the VPS is down
the site keeps working: place search falls back to the static index shipped
with the Worker, and the cron trigger takes over within 7 minutes.

## Security

| Link | Protection |
| --- | --- |
| Worker → service (search, status) | **Workers VPC**: the `VPS` binding is a VPC service over the `datxevui-vps` Cloudflare Tunnel to `127.0.0.1:8787`. The tunnel has no public hostname and no DNS record; cloudflared dials out, so no port is open for it. Every `/v1/*` call also carries the bearer `VPS_SERVICE_TOKEN`. |
| Service → Worker (cron tick) | HTTPS to `datxevui.com` with `CRON_SERVICE_TOKEN` (48 random characters), and the Worker accepts the tick only from the VPS's own addresses (`CRON_ALLOWED_IPS`). |
| GitHub → VPS (releases) | **Nothing inbound.** The `vps-service-update` timer pulls the newest `vX.Y.Z` release every 5 minutes and installs it only if its SHA-256 matches and its SSH signature verifies against the release key pinned in `update.sh` (CI signs with `RELEASE_SIGNING_KEY`). A failed start is rolled back and that release is not retried. |
| You → VPS | SSH on 22 only (ufw, rate-limited): key-only, user `ubuntu` only, no root, 3 tries, no agent/X11 forwarding (local port forwarding stays for `ssh -L 8787:127.0.0.1:8787`); sshguard bans repeat offenders. Break-glass: the OVHcloud KVM console. |
| The host | Automatic security updates; the service runs as its own user in a systemd sandbox (read-only system, writes only `/var/lib/vps-service`); secrets in `/etc/vps-service/env` (0640, root:vps-service). |

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

## Provision with OpenTofu

`vps/deploy/terraform` orders the VPS (VPS-1: 2 vCPU / 4 GB / 40 GB NVMe,
Singapore, Ubuntu 24.04; $5.35/month + the $0.50 daily backup OVHcloud
requires in SGP) and prepares the host as described in "Security", then
installs vps-service and its update timer. Credentials come from
`~/.ovh.conf` (endpoint `ovh-ca`, subsidiary ASIA).

```bash
cd vps/deploy/terraform
ssh-keygen -t ed25519 -N "" -f ~/.ssh/datxevui-vps        # your login key
tofu init -backend-config="path=$HOME/.config/datxevui/vps.tfstate"
tofu apply                                                # orders the VPS (no key yet)
python3 -I scripts/install-key.py "$(tofu output -raw service_name)" ~/.ssh/datxevui-vps.pub
echo 'image_id = "<printed id>"' >> terraform.tfvars
tofu apply                                                # prepares the host over SSH
```

The API lists OS images only for an existing VPS, hence the second step:
`install-key.py` rebuilds the fresh VPS with the key (wiping it, which is
fine on a new server) and prints the image id later VPS are ordered with.

## Connect it to the Worker

Secrets stay out of OpenTofu state, so these are done once by hand:

```bash
# 1. The private tunnel (no public hostname) and its connector on the VPS
cloudflared tunnel create datxevui-vps
cloudflared tunnel token datxevui-vps | ssh -i ~/.ssh/datxevui-vps ubuntu@<ip> \
  'read -r t; sudo cloudflared service install "$t"'
# 2. The Workers VPC service the `VPS` binding points at (id → wrangler.jsonc vpc_services)
cd cloudflare && bunx wrangler vpc service create datxevui-vps --type http \
  --tunnel-id <tunnel id> --ipv4 127.0.0.1 --http-port 8787
# 3. Tokens: the service's VPS_SERVICE_TOKEN to the Worker; one new CRON_SERVICE_TOKEN to both
ssh -i ~/.ssh/datxevui-vps ubuntu@<ip> 'sudo grep ^VPS_SERVICE_TOKEN= /etc/vps-service/env | cut -d= -f2-' \
  | bunx wrangler secret put VPS_SERVICE_TOKEN
# (generate a CRON_SERVICE_TOKEN, `wrangler secret put` it, and set it in /etc/vps-service/env)
```

`CRON_ALLOWED_IPS` in `wrangler.jsonc` holds the VPS's IPv4 and IPv6.
`/admin/system` then shows "Full index (VPS)" and "Driven by the VPS".

## Release to production

Push a tag; `.github/workflows/release.yml` does the rest:

```bash
git tag v1.2.0 && git push origin v1.2.0
```

It runs the service's checks and real-data index run, signs the binary and
attaches it to the tag's release, and deploys the Worker
(`cloudflare-deploy.yml`). Within 5 minutes the VPS's timer installs the
new release by itself (signature and checksum checked, rolled back if it
does not start). Merging to the default branch deploys nothing.

Repository settings: secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`RELEASE_SIGNING_KEY` (`~/.ssh/datxevui-release`, whose public half is
pinned in `vps/deploy/update.sh`); variable `SITE_URL`.

## Operate

```bash
journalctl -u vps-service -f                          # logs (index runs, failed jobs)
systemctl list-timers vps-service-update.timer          # when the next release check runs
sudo vps-service-update v1.2.0                         # install a release now (signed, rolls back if it fails to start)
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
