# Realtime Scalability — Research, Architecture & Roadmap

> Scope: how the chat WebSocket layer (`/ws`) and the WebRTC call stack
> (`/ws-call` + coturn TURN relay) scale — today, on this single node, and
> horizontally when the fleet grows. Written 2026-09-20 after a deep research
> pass over how Discord, Mattermost and Microsoft Teams run realtime at
> millions of users, plus published WebSocket/WebRTC benchmarks. Sources at
> the bottom.

---

## 1. Executive summary

**Question:** *"Realtime calls should have no limit on concurrent calls like
Discord/Mattermost/Teams; WebSocket chat limits should be hardware (RAM/CPU),
not numbers. What's the best-practice stack for performant, resource-efficient,
horizontally scalable realtime?"*

**Answer, as implemented in this repo:**

| Layer | Before | Now (this change) | Horizontal path |
|---|---|---|---|
| Chat WS capacity | static `WS_MAX_CONNECTIONS=50_000` | **0 = unlimited; hardware-bounded** by RAM + fd watermarks (`middleware::resource_guard`) | N replicas + Redis/NATS backplane (§7.1) |
| Call-signaling WS | static caps, per-IP 25 | **0 = unlimited; same hardware guard** | Same as chat (signaling is just WS) |
| Concurrent calls | bounded by TURN relay ports (601) | relay range widened **601 → 16 341 ports** (§6); bounded by bandwidth/CPU — i.e. the machine | Multi-coturn via DNS SRV / L4 LB (§7.2) |
| Per-IP caps | 25/real-IP (capacity-flavored) | **0 = disabled** — pure anti-abuse knob, off by default; NAT'd offices are first-class | stays a per-node knob |
| Visibility | conn count vs static cap | **live RAM/fd telemetry + `admitting: bool`** on the admin system endpoint | per-node + fleet roll-up |

The philosophical shift: a static cap is a *guess* that decouples the limit
from the machine — either it rejects legitimate load on a big box, or it never
fires before the box dies. Discord/Mattermost/Teams all bound capacity by
**infrastructure saturation + autoscaling**, never by a config integer. We now
do the same on one node: **the limit is the hardware**; scale-out is a fleet
operation (roadmap §7).

---

## 2. How the platforms we cited actually do it

### 2.1 Discord — the reference architecture

Discord has published more operational detail than anyone else in this space;
three posts matter to us.

**Gateway (chat/presence WebSocket — "How Discord Scaled Elixir to 5 000 000
Concurrent Users", 2017):**

- One Erlang process per WebSocket session; guild (server) state lives in
  *separate remote nodes*; publishes fan out cross-node to sessions.
- Bottleneck found by measurement: `send/2` between processes cost 30–70 µs,
  so one hot guild's publish could take 0.9–2.1 s. Fix: **Manifold** —
  distribute the fan-out work to the node where each recipient *lives*, so a
  publisher does at most `send` once per remote node.
- Lesson for us: fan-out cost dominates; route work to where the connection
  lives (that's exactly what a Redis/NATS backplane does for a multi-node
  version of our hub).

**Voice (media — "How Discord Handles 2.5 Million Concurrent Voice Users
Using WebRTC", 2018):**

- **Every** voice session is client→server, never peer-to-peer: a *signaling*
  component (Elixir, WebSocket) plus a **media relay — an SFU** forwarding RTP
  within channels. Reasons: multiparty scaling, IP privacy (DDoS), moderation.
- **850+ voice servers, 13 regions**, 2.6 M concurrent voice users, 220 Gbps
  egress, 120 Mpps — bare metal, rented from several providers.
- Assignment: voice servers **report health + load into service discovery
  (etcd)**; the Guilds service assigns the least-utilized server per guild,
  per region. Failover = clients notice the dead voice WS and *re-request* an
  assignment — no failover protocol, just reconnection (they call this out as
  deliberate: client-initiated connections everywhere = resilience).
- Lesson for us: our 1:1 P2P+TURN model is the resource-cheap version of this
  for calls that are *two-party*; the moment calls become group calls, the
  SFU is the only sane topology (mesh is O(n²) per participant).

**Rust adoption** ("Why Discord is switching from Go to Rust", 2020 + later
posts): predictable latency (no GC pauses) is why their hot data services and
subsequent rewrites went Rust. This validates our choice of a Rust backend for
realtime work.

### 2.2 Mattermost

Cluster HA = N identical app servers behind a load balancer + shared
PostgreSQL + **Redis pub/sub as the WebSocket backplane**: a message is
published once to Redis; every node checks whether the recipient's WS lives on
it and delivers locally (their own engineering + community docs). Sticky
sessions at the LB keep WS connections pinned. This is the textbook
"stateless app + broker" shape and the direct template for our §7.1.

### 2.3 Microsoft Teams

Media runs on Azure Communication Services infrastructure: regional **SFU
pools** (group calls; the transport interop layer their docs describe) plus
globally distributed **STUN/TURN relays** for NAT traversal — i.e. the same
two building blocks we run (coturn today; SFU only if/when group calls ship).

---

## 3. What one server can actually hold (benchmarks)

Published single-node numbers for idle WebSocket connections:

| Stack | Result | RAM per conn |
|---|---|---|
| uWebSockets.js (C++ core, Node API) | ~1 M conns in ~5.5 GB | **~5.4 KB** |
| AnyCable Pro (Go) | ~822 K conns in 14.8 GB | ~18 KB |
| Phoenix / Elixir (2015, 40-core/128 GB) | 2 M conns | ~50 KB incl. channels |
| Rust (tokio/tungstenite/axum — our stack) | no single canonical 1 M benchmark, but consistently the **lowest latency + most predictable throughput** of mainstream stacks; within 10–20 % of uWS on throughput with far richer per-conn state | ~20–50 KB (task + buffers) |

Key takeaways:

1. **The kernel is the real server.** All serious stacks are epoll/kqueue +
  a few threads; the app layer just must not add per-connection bloat. Our
  axum/tokio hub is in that family (1 task pair per socket, bounded outbound
  channel, no per-message allocation beyond the frame).
2. **The real ceilings on Linux are fds and RAM**, in that order of ugliness:
  every socket = 1 fd; exhausting `RLIMIT_NOFILE` breaks `accept()` for the
  whole process. Our new resource guard denies *new* WS upgrades at 90 % of
  the soft limit — degradation, not collapse.
3. **CPU does not bound *admission*** — 100 K idle sockets cost ~0 CPU. CPU
  bounds *throughput* (messages/s), which is what rate limits and,
  fleet-scale, load-shedding are for. This is why our admission control
  watches RAM + fds only.

### 3.1 Our node's honest capacity math (12 GiB / 6 cores)

- **Chat WS**: ~6–8 GiB headroom after app + engine + neighbours, at
  ~40 KiB/socket ⇒ **~150 K concurrent sockets** before the RAM watermark
  (512 MiB floor) fires. fd watermark (90 % of 1 048 576 = 943 K) never
  binds first. Comfortably beyond any realistic load for this product; the
  number that matters is that the guard fires *before* the OOM killer does.
- **TURN-relayed calls** (§6): 16 341 relay ports ⇒ ~2 000 fully-relayed
  calls by ports; **bandwidth and pps bind first** — ~150 kbps and ~200 pps
  per relayed call through the NIC ⇒ a 1 Gbps link saturates around
  **600–800 concurrent relayed calls**. Non-relayed (direct P2P after ICE)
  calls cost the server nothing — they are the majority when both sides have
  normal NAT behavior.

---

## 4. Stack verdict (the "which tech stack" question)

**Keep the Rust/axum + tokio core.** It is the correct choice on all three
axes the question names:

- *Performant*: lowest-latency, most-predictable mainstream WS stack
  (Discord's own reasoning for Rust on hot paths: no GC pauses).
- *Resource-efficient*: per-conn cost is near the floor for a full-featured
  runtime (uWS wins on raw footprint but is a C++ lib with a thin Node API —
  no auth/RBAC/presence ecosystem; you'd rebuild what we already have to save
  ~35 KB/conn, i.e. ~3.5 GB per 100 K conns).
- *Horizontally scalable*: WS state is process-local by design (hub), and
  the seam to distribute is narrow (§7.1). Elixir/Phoenix would buy
  battle-tested distribution primitives but cost a full rewrite; Node/uWS
  would cost the type system and the ecosystem we already run.

Where the stack is *deliberately* not ours to own:

- **Media stays P2P/TURN.** For 1:1 calls a media server (SFU) would *add*
  cost without benefit; coturn relays only the minority of calls that NAT
  forces. Discord runs SFUs because Discord calls are multiparty by design.
- **If group calls ship**: embed an SFU rather than grow one — LiveKit
  (Go/Pion, CNCF, horizontal "one or one hundred nodes" mesh, cascading
  regions) or mediasoup (Node/C++ lib, best raw per-core numbers, you own the
  clustering). Both are proven; both speak standard WebRTC so our client
  `RTCPeerConnection` code carries over.

---

## 5. What changed in this repo (the implementation)

### 5.1 Hardware-bounded admission — `src/middleware/resource_guard.rs`

Both WS upgrade handlers (`/ws` and `/ws-call`) now call `admit()` **after
auth, before any slot is taken**:

- Deny when host `MemAvailable` < `WS_MIN_FREE_MEM_MB` (default **512 MiB**;
  existing connections unaffected — only *new* upgrades get 503).
- Deny when open fds ≥ `WS_FD_HIGH_WATERMARK_PCT` % (default **90**) of the
  process soft `RLIMIT_NOFILE` (parsed once from `/proc/self/limits`).
- **Fail-open** when procfs is unavailable (dev machines): better to admit
  than to brick WS over a missing file; the static caps remain as operator
  overrides for such environments.
- Cost: two procfs reads per *upgrade* (not per message) — microseconds.
- Pure decision logic is unit-tested (boundaries, disabled knobs, missing
  readings); live-snapshot test is lenient so it passes off-Linux.

### 5.2 Config semantics (`WsConfig`)

| Env | Old | New | Meaning |
|---|---|---|---|
| `WS_MAX_CONNECTIONS` | 50 000 | **0 (unlimited)** | static override only; hardware is the default bound |
| `WS_MAX_PER_IP` | 25 | **0 (disabled)** | anti-abuse knob, off by default (50+ agents behind one office NAT is normal for us); both hubs now treat 0 = unlimited-and-still-counted |
| `WS_MIN_FREE_MEM_MB` | — | **512** | RAM floor for new connections |
| `WS_FD_HIGH_WATERMARK_PCT` | — | **90** | fd high watermark |

### 5.3 Observability

`GET /api/admin/system` → `websocket.resources` now reports
`memAvailableBytes`, `memFloorBytes`, `fdUsed`, `fdSoftLimit`, `fdUsedPct`,
`fdHighWatermarkPct` and **`admitting`** (would a new connection be accepted
right now) — the operator's at-a-glance headroom check.

### 5.4 Frontend/mobile

No client changes required: both WS clients already use exponential backoff
with jitter (500 ms × 2ⁿ, cap 15 s) on handshake failure, so a 503 during
resource pressure is handled by the existing reconnect path.

---

## 6. coturn capacity (the "unlimited calls" leg)

Per the coturn performance wiki (source list):

- coturn is async-IO + `≈ #cores` threads; **each allocation costs ≥ 1 fd**
  and no thread — "thousands or tens of thousands" of allocations per box is
  the design envelope; SQLite (our config) is its fastest db option.
- TURN scaling options, in order of their preference: **L4 load balancer with
  per-client-IP affinity**, **round-robin DNS**, or `ALTERNATE-SERVER` 300
  redirects (note: WebRTC clients ignore alternate-server today).

Measured on our box (deploy/turn_loadtest.py): the old 41-port range died at
exactly 40 allocations (STUN 508); the 601-port range passed **480/480**
concurrent allocations. A fully-relayed 1:1 call makes up to 8 allocations
(both peers × multiple ICE candidates), so:

| Relay range | Ports | ≈ relayed-call ceiling (ports) | Real binder |
|---|---|---|---|
| 49160–49200 (old) | 41 | ~5 | ports |
| 49160–49760 (v0.5.8) | 601 | ~75 | ports |
| **49160–65500 (this change)** | **16 341** | **~2 000** | **NIC bandwidth / pps (~600–800 @ 1 Gbps)** |

Companion host changes (tune-call-capacity.sh):

- `net.ipv4.ip_local_port_range` narrowed to `32768–49159` so the kernel's
  *ephemeral* (outbound) range and coturn's relay range never overlap — with
  16 K relay ports the default 32768–60999 would collide.
- coturn container gets an explicit `--ulimit nofile=1048576` (16 K relay fds
  + listeners + margin) and 2 GiB memory.
- ufw widened to `49160:65500/udp`; nginx stream `worker_connections`
  4096 → 16384 (all public TLS — including TURN-TLS — crosses the SNI
  router); conntrack raised to 524 288 with hash buckets sized to match.

---

## 7. Horizontal scalability roadmap

Single-node capacity (§3.1/§6) is far beyond current load. When it isn't
anymore, these are the steps — each is additive, no rewrite:

### 7.1 WebSocket chat + call signaling (the hub)

1. **Node-local state is already the design** — sessions, rooms, presence
   live in the hub; nothing else holds sockets. The distribution seam is
   small: wherever the hub does `send_to_user/channel/brand`, route through
   an interface with two impls: `LocalBackplane` (today) and `RedisBackplane`
   (publish on a `user:{id}` / `channel:{id}` shard; every node subscribes
   and delivers to its local sockets — the Mattermost shape).
   Redis pub/sub is the pragmatic first backplane (already in the stack
   family, simple); NATS is the step-up if cross-region or >100 K msg/s
   fan-out ever matters (Discord-scale systems standardize on it).
2. **LB affinity**: Caddy `reverse_proxy` with `lb_policy cookie` (or Consul
   Discovery) — WS is long-lived, so stickiness only affects reconnects.
3. **Shared state stays in Postgres/Redis** (it already is: auth sessions,
   channel existence, RBAC — nothing reads hub state on the request path).

### 7.2 TURN relay

coturn is stateless-per-allocation: run 2..N coturn containers/hosts and hand
clients different entries — either `turn:` URLs list (browsers try in order —
zero infra change), DNS SRV round-robin, or an L4 balancer with IP affinity
per the wiki's guidance. No shared db needed unless quotas return.

### 7.3 Group calls (only if the product goes there)

Don't grow a media server — embed one: **LiveKit** self-hosted (horizontal
mesh, region cascading, CNCF) or **mediasoup** (max per-core efficiency, app
owns clustering). Our WebRTC client code, TURN infra and signaling patterns
carry over; the SFU replaces the P2P media leg for n>2 only.

### 7.4 What intentionally does NOT change

- Client-initiated reconnects everywhere (Discord's resilience model) — our
  clients already do this (backoff + ICE restart + ring re-request).
- Heartbeat + idle timeout + bounded outbound channels — these are what make
  150 K idle sockets safe (no unbounded per-conn growth).
- Rate limits stay per-user/per-IP *throughput* controls — orthogonal to
  connection *capacity*.

---

## 8. Sources

- Discord — *How Discord Scaled Elixir to 5 000 000 Concurrent Users*
  (discord.com/blog/how-discord-scaled-elixir-to-5-000-000-concurrent-users)
- Discord — *How Discord Handles Two and Half Million Concurrent Voice Users
  Using WebRTC*
  (discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc)
- Discord — *Why Discord is switching from Go to Rust*
  (discord.com/blog/why-discord-is-switching-from-go-to-rust)
- Mattermost — HA cluster docs + community scaling write-ups (docs.mattermost.com)
- coturn wiki — *TURN relay server performance: load balance and network
  optimization* (github.com/coturn/coturn/wiki/TURN-Performance-and-Load-Balance)
- LiveKit docs — SFU architecture / horizontal scalability (docs.livekit.io)
- websocket.org — *WebSockets at Scale* + *WebSocket Connection Limits: The
  Real Bottlenecks* (fd/memory ceilings, 2024–2026)
- Evil Martins / anycable.io — Node WebSocket server benchmarks at 1 M
  connections (uWS ~5.4 KB/conn vs AnyCable ~18 KB/conn)
- Chris McCord — *The Road to 2 Million Websocket Connections in Phoenix*
  (phoenixframework.org, 2015)
- Linux kernel docs — *Scaling in the Linux Networking Stack* (RSS/RPS —
  relevant to coturn UDP throughput)
