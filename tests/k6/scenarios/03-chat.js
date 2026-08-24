/**
 * 03-chat.js — chat load test.
 *
 * Simulates customer chat sessions:
 *   - List channels (refresh the channel list)
 *   - Create or reuse a channel
 *   - List the latest 30 messages (DESC page 0)
 *   - List the next 30 older messages (offset=30) — exercises the
 *     infinite-scroll pagination path
 *   - Send 5 messages with random content + random think-time
 *   - Mark the channel as read
 *
 * ## Realtime note
 *
 * This exercises the REST surface only. The backend's REST
 * `POST /api/chat/channels/{id}/messages` does broadcast to the WS
 * room after insert (see `src/routes/chat.rs::post_message`), so
 * this generates real load on the message-insert + WS-broadcast path
 * even without a WS client.
 *
 * ## Setup
 *
 * Each VU registers a new customer account at the start (via `setup`
 * is shared across all VUs — we want per-VU sessions, so we do it
 * in the default function on the first iteration). Subsequent
 * iterations reuse the same VU's session (cookie jar persists).
 *
 * Run:
 *   k6 run tests/k6/scenarios/03-chat.js
 */

import { sleep } from 'k6';
import { register, me } from '../helpers/auth.js';
import {
  listChannels,
  createChannel,
  listMessages,
  sendMessage,
  markRead,
  zeroclawStatus,
} from '../helpers/chat.js';

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // ramp up to 20 concurrent chatters
    { duration: '1m', target: 20 },    // hold
    { duration: '30s', target: 50 },   // ramp up to 50
    { duration: '1m', target: 50 },    // hold
    { duration: '30s', target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    http_req_failed: ['rate<0.02'],
  },
};

// Track whether the VU has registered yet. Each VU registers once
// on its first iteration, then reuses the session for all subsequent
// iterations. This mirrors a real user opening the chat widget + it
// staying open for multiple conversations.
const vuRegistered = new Map();

export function setup() {
  // Shared setup — just verify the server is up + ZeroClaw is reachable.
  zeroclawStatus();
  return { started: Date.now() };
}

export default function (data) {
  // Register on first iteration for this VU.
  if (!vuRegistered.has(__VU)) {
    const reg = register();
    if (reg.status === 200) {
      vuRegistered.set(__VU, true);
      sleep(0.3);
      me();  // verify
    }
    return;  // skip the chat flow on the first iteration
  }

  // ── Chat session ──────────────────────────────────────────────
  listChannels();
  sleep(0.3);

  const ch = createChannel();
  if (ch.status !== 200) return;
  let channelId;
  try {
    channelId = ch.json('channel.id');
  } catch {
    return;
  }
  if (!channelId) return;

  // Page 0 — latest 30 messages.
  listMessages(channelId, 30, 0);
  sleep(0.2);

  // Page 1 — next 30 older messages (exercises infinite scroll).
  listMessages(channelId, 30, 30);
  sleep(0.3);

  // Send 5 messages with random think-time.
  for (let i = 0; i < 5; i++) {
    sendMessage(channelId);
    sleep(0.5 + Math.random() * 1.5);  // 0.5–2s think time
  }

  markRead(channelId);
  sleep(0.5);
}

export function teardown(data) {
  const elapsed = (Date.now() - data.started) / 1000;
  console.log(`Chat scenario completed in ${elapsed.toFixed(1)}s`);
}
