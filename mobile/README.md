# VeXeVN Tổng đài — Support Agent Mobile Client

Flutter mobile app (Android + iOS) for the support agent: **live chat with
customers and WebRTC audio calls**, with instant local notifications when a
new customer needs help.

Built with **Forui** (`forui` + `forui_lucide`, on top of the new
`material_ui` Material library), **Riverpod 3** for state, **go_router** for
navigation, **dio** for REST, and **flutter_webrtc** for calls.

## Features

- **Login** (`POST /api/auth/employee-login`, staff-only) with the raw-token
  mobile flow (`X-Client: mobile` header → `tokens` in the JSON body),
  persisted in the platform keystore (`flutter_secure_storage`).
- **Support queue** — all open channels with unread badges, last-message
  previews, assignment state; filter tabs (all / unassigned / mine);
  claim / release / close actions.
- **Chat rooms** — realtime over `/ws` (join, typing indicators, presence,
  read receipts), optimistic sends with `clientMsgId` reconciliation and
  retry, pagination-ready (newest-first REST history, reversed for display).
- **Calls** — WebRTC audio over `/ws-call` signaling: the agent registers as
  an agent and receives `incoming` offers; mic mute, speaker toggle, ring
  timeout auto-busy, ICE-failure recovery.
- **Notifications** — local notifications for new customer messages, new
  support requests, and incoming calls while backgrounded; tapping
  deep-links to the room or call screen.
- **Team board** — staff presence (online / available / in-call / active
  chats) from `GET /api/presence/staff` + `staff_presence` broadcasts.
- **Settings** — server address, theme (light/dark/system), alert toggle,
  logout.

## Architecture

Feature-first layout; every feature owns its controller(s) + screen(s),
shared plumbing lives in `lib/core`:

```
lib/
├── main.dart                  # bootstrap (ProviderScope)
├── app.dart                   # theme plumbing, call-screen nav, notification taps
├── core/
│   ├── env.dart               # AppConfig (server URL: dart-define / persisted / dev default)
│   ├── router.dart            # go_router: login, 3-branch shell, /call overlay
│   ├── theme_mode.dart        # persisted theme + alert toggles
│   ├── auth/                  # models, TokenStore (secure storage), AuthController
│   ├── net/
│   │   ├── api_client.dart    # dio: Bearer auth, single-flight 401→refresh→retry
│   │   └── ws_client.dart     # JSON-envelope WS with jittered backoff reconnect
│   └── models/ (chat DTOs)
├── features/
│   ├── login/                 # staff login screen
│   ├── chat/                  # queue (conversations_*) + room (rooms_*, room_screen)
│   ├── call/                  # state machine, WebRTC engine, /ws-call signaling, screen
│   ├── notifications/         # local notifications + agent alert wiring
│   ├── team/                  # presence board
│   └── settings/
└── shared/                    # HomeShell (bottom nav), shared widgets
```

Key behaviors:

- **One WS per purpose**: `/ws` (chat events) and `/ws-call` (call
  signaling + agent presence) each get a `WsClient` with full-jitter
  exponential backoff, capped at 30 s; both authenticate via
  `?token=<jwt>` and rebuild the URL on every (re)connect so token
  rotation is transparent. App resume triggers an immediate reconnect.
- **REST is the source of truth** for the queue: WS events patch rows
  optimistically, then trigger a debounced refetch — no drift.
- **Optimistic sends**: the message appears instantly (`SendState.sending`),
  the REST response reconciles it; WS echo + REST response are deduped by
  message id / `clientMsgId`.
- **Call state machine** (`CallStatus`: idle → calling/incoming →
  connecting → active → ended) drives the `/call` overlay via a derived
  `callNavProvider` — screens never push it by hand.

## Backend requirements

Ships with the matching backend changes in this repo:

1. **Bearer auth for REST** — `Authorization: Bearer <jwt>` accepted by the
   auth extractors (`src/middleware/auth_extractor.rs`); browsers keep
   using httpOnly cookies.
2. **Raw tokens for mobile login** — requests with `X-Client: mobile` get
   `tokens: {accessToken, refreshToken}` in the auth JSON body
   (`src/routes/auth.rs`).
3. **WS for non-browser clients** — upgrades that authenticate via
   `?token=<jwt>` skip the browser-Origin check (`check_ws_origin`);
   cookie-only handshakes without an Origin header are still rejected
   (CSWSH defense intact).

ICE servers come from the server (`registered` frame,
`AUDIO_CALL_ICE_SERVERS`); a public STUN pair is the fallback. For strict
NATs configure a TURN server there.

## Build & run

```bash
cd mobile
flutter pub get

# Dev: point at your machine (Android emulator loopback is the default):
flutter run                                  # http://10.0.2.2:8080

# Production server baked in:
flutter build apk --release \
  --dart-define=API_BASE_URL=https://datxevui.com
flutter build ipa --release \
  --dart-define=API_BASE_URL=https://datxevui.com
```

The agent can also set/change the server address in-app (login screen gear
icon → Settings), persisted locally; `--dart-define` locks it for managed
deployments.

Analysis/tests:

```bash
flutter analyze   # 0 issues
flutter test      # smoke test: boots to login
```

## Push notifications (upgrade path)

Local notifications fire while the app process is alive (foreground or
recently backgrounded). For true killed-app push (FCM/APNs):

1. `flutterfire configure` and add `firebase_messaging`;
2. Add a `POST /api/devices` endpoint storing FCM registration tokens per
   user;
3. Fan out `channel_message` / incoming-call push from the backend WS
   handlers (the payload/route contract used by the local notifications —
   `{"type":"chat","channelId":...}` / `{"type":"call"}` — is already FCM-
   shaped).

The repository layout and `NotificationService.onTap` wiring are ready for
that addition; no app restructure needed.
