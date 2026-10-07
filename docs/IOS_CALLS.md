# iOS production calls — VoIP push + CallKit

This is the runbook for receiving support calls on an iPhone **in
production**: app suspended in the pocket, screen off, customer taps the
call button on the web widget → the phone rings with the caller's name
and avatar on the native CallKit screen.

## Why this needs special plumbing

iOS suspends an app within seconds of backgrounding — the `/ws-call`
signaling socket dies with it. A plain WebSocket ring therefore only
reaches phones that are foregrounded. Android covers the closed-app case
with a duty-mode foreground service + FCM high-priority data messages;
Apple offers exactly one equivalent: **APNs VoIP pushes**, which wake the
app even when it is terminated.

Two Apple constraints shape the design:

1. **Firebase cannot send VoIP pushes.** FCM only proxies regular APNs
   (`apns-push-type: alert|background`), so the backend talks to APNs
   directly for iOS devices (`src/push/apns.rs`).
2. **Every VoIP push must be reported to CallKit** (iOS 13+). A VoIP
   push that does not surface a `CXCall` gets the app killed by the OS.
   The mobile app satisfies this by handing the push payload to
   `flutter_callkit_incoming`, which reports it and shows the native
   incoming-call screen.

## The end-to-end flow

```text
customer (web)            backend                        iPhone (suspended)
     │  offer WS frame ─▶ audio_call handler                  │
     │                    │ session Ringing (caller name+     │
     │                    │ avatar captured from the caller's  │
     │                    │ VERIFIED auth session)             │
     │                    │ ── incoming frame ──▶ dead socket  │  (lost — fine)
     │                    │ ── APNs VoIP push ───────────────▶ │  (wake!)
     │                    │    {id, nameCaller, handle,        │
     │                    │     avatar, duration, extra}       │
     │                    │                          PushKit → CallKit ring
     │                    │                          (caller identity shown)
     │                    │              app wakes, /ws-call reconnects,
     │                    │ ◀──── register ────────────────────┤
     │                    │ ── registered {activeCall} ───────▶ │  (reconcile)
     │                    │ ── incoming frame (RE-DELIVERED) ─▶ │  (the offer!)
     │  ◀──── answer ─────│                          agent taps Accept
     │                    │                          WebRTC media flows
```

Three pieces make this work:

* **Backend `src/push/apns.rs`** — minimal APNs HTTP/2 client (token
  auth: ES256 JWT from the `.p8` key, cached <1h; `apns-push-type:
  voip`, `apns-expiration` bounded to the ring window). The push
  payload is `flutter_callkit_incoming`-shaped: the caller's name and
  avatar (from the caller's verified auth session — never client-
  supplied) plus the ring duration.
* **Backend re-delivery** (`re_deliver_missed_offer_to` in
  `src/audio_call/handler.rs`) — the original `incoming` offer went to
  a dead socket; when the freshly-woken app re-registers, the server
  re-sends the offer **on that socket, after `registered`**. Without
  it, the CallKit ring could never be answered — the offer was lost.
* **Mobile `lib/features/call/callkit_service.dart` + native
  PushKit wiring in `ios/Runner/AppDelegate.swift`** — bridges native
  accept/decline into the shared call controller (including the
  accept-before-offer race), registers the PushKit VoIP token with
  `POST /api/push/devices`, and ends orphan native rings whenever the
  shared call state goes idle.

Android is untouched by all of this: the plugin is dormant there and
the existing duty-mode + FCM + full-screen-notification path continues
to work.

## Apple Developer Console setup (one-time)

1. **Keys → create a key** with the *Apple Push Notifications service
   (APNs)* capability. Download the `.p8` file, note the **Key ID**
   (10 chars) and your **Team ID** (10 chars, Membership page).
2. **Identifiers → your app's bundle id** (`APNS_TOPIC`) — no extra
   capability is needed for VoIP pushes beyond being an app id; the
   `voip` background mode is already declared in
   `mobile/ios/Runner/Info.plist`.
3. No certificates needed — the backend uses token-based auth, which
   works for both sandbox and production and does not expire.

## Backend configuration

```dotenv
APNS_KEY_PEM=-----BEGIN PRIVATE KEY-----\nMIG...\n-----END PRIVATE KEY-----
#   …or mount the file and point at it instead:
# APNS_KEY_PATH=/run/secrets/apns_key.p8
APNS_KEY_ID=ABC123DEFG
APNS_TEAM_ID=TEAM12345
APNS_TOPIC=com.datxevui.support
APNS_SANDBOX=false        # true while signed with a dev profile
```

Both transports are independent: `FCM_CREDENTIALS_JSON` covers Android,
`APNS_*` covers iOS; either may be empty. Boot logs state clearly which
are enabled (`push: APNs VoIP enabled (topic …, sandbox=…)`).

## App-side notes

* The PushKit token is registered after login (idempotent) and
  unregistered on logout — a signed-out phone is never rung.
* Mic permission is requested by WebRTC when the agent accepts; iOS
  shows the prompt over the CallKit screen the first time only.
* When the app is foregrounded, the in-app call screen handles the ring
  (it shows the same caller identity from the WS frame); CallKit is
  only the background/suspended path.

## Known limitation: ring cancellation

If a ring is re-routed to another agent (or the customer gives up)
while the phone is suspended, the native CallKit screen is not actively
cancelled — a VoIP push that does not report a call would violate
Apple's policy. Instead:

* the CallKit ring carries the server's ring window as its `duration`,
  so an unanswered ring self-cleans into a missed-call notification
  exactly when the janitor expires the session;
* the next time the app's socket reconnects (unlock, open, next push),
  `registered.activeCall` + the call-state reconcile end any orphan.

This is the same trade-off WhatsApp-style VoIP apps make.

## Testing

* **Unit** — `cargo test -p rust-be-template push::` covers the APNs
  client (ES256 JWT shape, Apple-mandated headers, 410 → token-pruned)
  and the CallKit payload contract; the audio-call handler tests cover
  caller identity in `incoming` frames and the register re-delivery.
* **Device** — CallKit only works on REAL iPhones (the simulator does
  not deliver VoIP pushes). Configure the `APNS_*` env group with
  `APNS_SANDBOX=true`, run the app on a device signed with a dev
  profile, background it, and place a call from the web widget.
* **Payload sanity** — `push: apns send <status>: <body>` warnings in
  the backend log carry Apple's exact rejection reason
  (`TopicMismatch`, `BadDeviceToken`, …) — the first place to look
  when pushes do not arrive.
