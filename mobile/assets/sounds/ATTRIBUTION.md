# Sound attribution

All tunes in this folder are real, production messenger sounds from
open-source projects under the Apache License 2.0 — nothing here is
synthesised or hand-rolled. Each file was converted to MP3 (ffmpeg,
96 kbps, 44.1 kHz) from the upstream source.

| File              | Plays when                    | Upstream source                                            |
| ----------------- | ----------------------------- | ---------------------------------------------------------- |
| `message.mp3`     | new customer message          | AOSP `notifications/pixiedust.ogg` ("Pixie Dust")          |
| `request.mp3`     | new support request in queue  | AOSP `notifications/tweeters.ogg` ("Tweeters")             |
| `ring.mp3`        | incoming call (loops)         | AOSP `ringtones/material/ogg/Titania.ogg` ("Titania")      |
| `ringback.mp3`    | outbound call, waiting tone   | Jitsi Meet `sounds/outgoingRinging.mp3`                    |
| `call_joined.mp3` | both sides connected          | Jitsi Meet `sounds/joined.mp3`                             |
| `call_ended.mp3`  | call finished                 | Jitsi Meet `sounds/left.mp3`                               |

## Sources

* **Android Open Source Project (AOSP)** — `frameworks/base/data/sounds`
  (notifications and Material ringtones). Copyright Google LLC.
  Licensed under the Apache License, Version 2.0.
  https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/data/sounds/

* **Jitsi Meet** — `sounds/` in the jitsi-meet repository.
  Licensed under the Apache License, Version 2.0.
  https://github.com/jitsi/jitsi-meet/tree/master/sounds

The same `message`/`request`/`ring` files are additionally installed as
Android raw resources (`android/app/src/main/res/raw/`) so notification
channels can reference them, and as iOS bundle resources
(`ios/Runner/*.mp3`) so `DarwinNotificationDetails(sound:)` can play
them.

## License

Apache License 2.0 (both sources). A copy is available at
https://www.apache.org/licenses/LICENSE-2.0
