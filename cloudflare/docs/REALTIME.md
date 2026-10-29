# Realtime (chat + audio call) — architecture & scalability notes

Deep-researched and verified against Cloudflare's current documentation
(TURN Service docs, Realtime/SFU architecture, Durable Objects websocket
hibernation) and validated live with the smoke tests in `scripts/`.

## Topology

```
 Browser tabs (customer widget / staff workspace)
   │  /ws   JSON envelope protocol          ChatHub  (Durable Object "global")
   │  /ws-call  SDP/ICE relay frames        CallHub  (Durable Object)
   │  REST /api/chat/* durable source of truth + fallback
   ▼
 Cloudflare edge (anycast) — DOs live next to users, single-threaded,
 each instance ~1k req/s; the app uses ONE ChatHub instance (all sockets)
 and per-namespace CallHub instances.
 Media (audio): peer-to-peer WebRTC; TURN relays only when direct fails.
```

## Cross-network & corporate-firewall call support (verified)

- **ICE servers are server-pushed** in the `registered` frame (and rotated
  every 30 minutes as `ice-servers` frames). With `TURN_KEY_ID` +
  `TURN_KEY_API_TOKEN` configured, Cloudflare mints short-lived (TTL)
  credentials via `POST /v1/turn/keys/{id}/credentials/generate-ice-servers`
  — the exact API `src/lib/services/turn-credentials.ts` implements
  (response zod-validated, TTL clamped to [600s, 24h]).
- Cloudflare's managed TURN answers on every transport a corporate network
  can still allow out: `turn:` UDP 3478/443, TCP 3478/80, and — the
  HTTPS-only-proxy lifeline — **`turns:` (TURN over TLS) on TCP 5349 and
  TCP 443**. Anycast routes each client to the nearest Cloudflare PoP.
- **Long calls keep working after credential rotation**: the client now
  calls `RTCPeerConnection.setConfiguration({ iceServers })` when a fresh
  `ice-servers` frame arrives mid-call (the documented way to refresh TURN
  credentials during a session), so a later ICE restart never signs in
  with expired credentials.
- **Fast call setup on hostile networks**: `iceCandidatePoolSize: 2`
  pre-opens relay sockets, so answered→connected stays inside the media
  deadline even where TURN-over-TLS takes seconds.
- **Resilience**: trickle ICE with outbound candidates buffered while the
  signalling socket is down and re-sent on reconnect; inbound candidates
  buffered until the remote description exists; bounded ICE restarts
  driven by the original offerer when the media path drops (Wi-Fi→LTE
  switches); jittered-backoff socket reconnect; zombie-call detection on
  re-register (`registered.activeCall`).
- Without TURN keys the hub serves public STUN — calls still work on
  friendly networks; hard-to-reach networks simply fail gracefully.
  Pricing when enabled: $0.05/GB TURN egress (~22 MB per audio-call hour,
  relays engage only when the direct path fails).

## Hibernation (verified live)

Both DOs are hibernation-safe: session state rides each WebSocket's
attachment (`serializeAttachment`), the live set always comes from
`ctx.getWebSockets()`, and heartbeats are answered by the platform via
`setWebSocketAutoResponse` **without waking the DO**:

- `/ws` — fixed `{"type":"ping"}` auto-answers `{"type":"pong"}`
  (verified by `scripts/ping-autoresponse-test.mjs`); timestamped pings
  from older clients still take the `webSocketMessage` fallback.
- `/ws-call` — `{"type":"heartbeat"}` auto-answers
  `{"type":"heartbeat-ack"}`.

Thousands of idle sockets therefore cost ~nothing, and a DO that
hibernates rehydrates from attachments instead of dropping its sockets.

## Scale characteristics

- **Chat**: one ChatHub DO serializes all chat traffic. Single-threaded
  DOs comfortably handle ~1k req/s; support-chat volume (messages +
  typing + presence) is far below that. If it ever isn't, the fan-out key
  is per-channel DOs — the protocol already carries `channelId`, so the
  sharding cut is mechanical.
- **Calls**: signalling is featherweight (a few frames per call); audio
  is peer-to-peer, so CallHub load scales with call _setup_ events, not
  with call minutes. TURN/SFU capacity is Cloudflare's problem — the
  managed TURN runs on the same 330+ PoP network, anycast.
- **Backpressure**: frames are small JSON; sends are wrapped in
  try/catch (closed-mid-send tolerated). The REST layer (D1) remains the
  durable source of truth and the reconnect fallback for chat.

## The mobile app (Flutter agent console)

`mobile/` speaks the same two protocols as the web, with these differences,
all covered by `tests/hubs/` (the real `ChatHub` / `CallHub` classes run in
workerd, driven with the app's own frames):

- The credential rides in `?token=` (no cookie, no Origin); REST calls carry
  `X-Client: mobile`, which the origin check exempts. Tokens are refreshed
  with `{refresh_token}` in the body.
- It **sends** chat over REST (`clientMsgId`, idempotent) and only
  **receives** over `/ws`; the socket echo is de-duplicated by message `id`.
  The queue row is patched from the `channel_message` frame's `preview`.
- `/ws-call` heartbeat is `{"type":"heartbeat","__client_ts":…}` every 20 s;
  any frame resets its 50 s half-open watchdog, so the hub's `pong` keeps a
  healthy socket from being recycled.
- A call survives a Wi-Fi ↔ LTE switch: the new socket registers with
  `resume: true` inside the 15 s grace window and receives `activeCall`.
- A phone woken by a VoIP push re-registers and is handed the still-ringing
  offer (`incoming`, from the customer's side).

**Closed-app ringing needs secrets the Worker does not have by default**:
`APNS_KEY_PEM`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` (iOS VoIP) and
`FCM_CREDENTIALS_JSON`. Without them the ring only reaches a phone whose
app is awake and holding its socket (Android duty mode, iOS in the
foreground); an iPhone with the app suspended or closed never hears the call.

## Smoke tests (all passing against the OpenNext preview)

| Script                               | Verifies                                                               |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `scripts/ws-smoke-test.mjs`          | login → WS upgrade → hello/staff_presence → pong                       |
| `scripts/chat-flow-test.mjs`         | customer/staff pair: message relay, typing, persistence, WS+REST dedup |
| `scripts/call-hub-test.mjs`          | register + iceServers push, incoming, hangup                           |
| `scripts/ping-autoresponse-test.mjs` | platform-level ping auto-response (no DO wake) + legacy fallback       |

## Production TODO when going live

1. Set secrets `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` (a Calls/TURN key from
   the Cloudflare dashboard) → corporate-network relay support turns on.
2. Set up the VPS service (`vps/README.md`), which drives the cron jobs and
   place search; without it the Worker's own cron trigger runs the jobs.
3. Set `TURN_TTL_SECONDS` only if you want shorter-lived credentials than
   the 24h default (clamped to [600, 86400]).
