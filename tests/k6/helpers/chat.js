/**
 * chat.js — chat channel + message helpers for k6 tests.
 *
 * Wraps the chat REST endpoints with k6's check + cookie jar. All
 * helpers assume the VU is already authenticated (via `login()` or
 * `register()` in auth.js).
 *
 * ## Endpoints covered
 *
 *   GET  /api/chat/channels                — list channels (admin sees all open, customer sees own)
 *   POST /api/chat/channels                — create or reuse a channel
 *   GET  /api/chat/channels/{id}/messages  — list messages (DESC, paginated)
 *   POST /api/chat/channels/{id}/messages   — send a message (REST fallback for WS)
 *   POST /api/chat/channels/{id}/read       — mark the channel as read
 *   GET  /api/zeroclaw/status               — AI bot status
 *   GET  /api/zeroclaw/exchanges            — AI audit log
 *
 * ## Realtime note
 *
 * These helpers exercise the REST surface only. The WebSocket flow
 * (`/ws`) is NOT covered by k6's `http` module — for WS load
 * testing, use `k6/ws` (experimental) or a separate WS client. The
 * REST `POST /api/chat/channels/{id}/messages` does broadcast to the
 * WS room (see `src/routes/chat.rs::post_message`), so it's a valid
 * load generator for the message-insert + WS-broadcast path even
 * without a WS client.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, withAuth, randomMessage } from '../config.js';

/**
 * List chat channels.
 *
 * - For customers: returns only their own channels.
 * - For employees (admin): returns ALL open channels (the support queue).
 *
 * @param {number} [limit=50] — max channels to return
 * @returns {object} the k6 response (200 = success, `res.json().items` = array)
 */
export function listChannels(limit = 50) {
  const res = http.get(
    `${BASE_URL}/api/chat/channels?limit=${limit}`,
    withAuth(),
  );
  check(res, {
    'listChannels status 200': (r) => r.status === 200,
    'listChannels has items array': (r) => {
      try {
        return Array.isArray(r.json('items'));
      } catch {
        return false;
      }
    },
  });
  return res;
}

/**
 * Create a new chat channel OR return the existing open one.
 *
 * The backend enforces "1 open channel per user per brand" — so if
 * the VU already has an open channel, this returns it instead of
 * creating a duplicate.
 *
 * @param {string} [brandId] — optional brand to attach
 * @param {string} [topic] — optional topic (defaults to "Hỗ trợ")
 * @returns {object} the k6 response — `res.json().channel.id` is the channel UUID
 */
export function createChannel(brandId, topic) {
  const body = {};
  if (brandId) body.brandId = brandId;
  if (topic) body.topic = topic;
  const res = http.post(
    `${BASE_URL}/api/chat/channels`,
    JSON.stringify(body),
    withAuth(),
  );
  check(res, {
    'createChannel status 200': (r) => r.status === 200,
    'createChannel has channel id': (r) => {
      try {
        return r.json('channel.id') !== null && r.json('channel.id') !== undefined;
      } catch {
        return false;
      }
    },
  });
  return res;
}

/**
 * List messages in a channel.
 *
 * The backend returns messages in DESC order (newest first) for
 * cursor pagination. `limit` defaults to 30, `offset` to 0.
 *
 * @param {string} channelId — the channel UUID
 * @param {number} [limit=30] — page size
 * @param {number} [offset=0] — cursor offset (0 = latest page)
 * @returns {object} the k6 response — `res.json().items` = array of messages
 */
export function listMessages(channelId, limit = 30, offset = 0) {
  const res = http.get(
    `${BASE_URL}/api/chat/channels/${channelId}/messages?limit=${limit}&offset=${offset}`,
    withAuth(),
  );
  check(res, {
    'listMessages status 200': (r) => r.status === 200,
    'listMessages has items array': (r) => {
      try {
        return Array.isArray(r.json('items'));
      } catch {
        return false;
      }
    },
  });
  return res;
}

/**
 * Send a chat message via REST.
 *
 * This is the REST fallback for when the WebSocket is unavailable —
 * but it's also the primary load path for k6 (k6's `http` module
 * can't do WS). The backend broadcasts the message to the channel
 * room after insert, so this exercises the full insert + broadcast
 * path even without a WS client.
 *
 * Idempotent via `clientMsgId` — if the same id is reused, the
 * stored message is returned without re-inserting. We generate a
 * unique id per call so retries don't dedupe.
 *
 * @param {string} channelId — the channel UUID
 * @param {string} [content] — message body (defaults to a random Vietnamese phrase)
 * @param {string} [kind='text'] — message kind ('text' | 'ticket' | 'system')
 * @param {string} [attachments] — optional JSON-encoded attachments string
 * @returns {object} the k6 response — `res.json().message.id` is the new message UUID
 */
export function sendMessage(channelId, content, kind = 'text', attachments) {
  const body = {
    content: content || randomMessage(),
    kind,
    clientMsgId: `k6-${__VU}-${__ITER}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  if (attachments) body.attachments = attachments;
  const res = http.post(
    `${BASE_URL}/api/chat/channels/${channelId}/messages`,
    JSON.stringify(body),
    withAuth(),
  );
  check(res, {
    'sendMessage status 200': (r) => r.status === 200,
    'sendMessage has message id': (r) => {
      try {
        return r.json('message.id') !== null && r.json('message.id') !== undefined;
      } catch {
        return false;
      }
    },
  });
  return res;
}

/**
 * Mark a channel as read for the current user's side.
 *
 * - Customer caller → clears `unread_user` counter.
 * - Employee caller → clears `unread_employee` counter.
 *
 * @param {string} channelId — the channel UUID
 * @returns {object} the k6 response (200 = success)
 */
export function markRead(channelId) {
  const res = http.post(
    `${BASE_URL}/api/chat/channels/${channelId}/read`,
    null,
    withAuth(),
  );
  check(res, {
    'markRead status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Fetch the ZeroClaw AI bot status.
 *
 * Returns `{ enabled: bool, provider: 'noop' | 'http' }`. No auth
 * required — useful as a cheap unauthenticated probe.
 *
 * @returns {object} the k6 response
 */
export function zeroclawStatus() {
  const res = http.get(`${BASE_URL}/api/zeroclaw/status`, withAuth());
  check(res, {
    'zeroclawStatus status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * List ZeroClaw audit exchanges (admin dashboard).
 *
 * Returns the AI reply audit log. No auth required by the endpoint
 * (it's a public read), but in production you'd gate it behind RBAC.
 *
 * @param {number} [limit=50]
 * @param {number} [offset=0]
 * @returns {object} the k6 response
 */
export function listZeroclawExchanges(limit = 50, offset = 0) {
  const res = http.get(
    `${BASE_URL}/api/zeroclaw/exchanges?limit=${limit}&offset=${offset}`,
    withAuth(),
  );
  check(res, {
    'listZeroclawExchanges status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Convenience: simulate a customer chat session.
 *
 *   1. List channels (refresh the queue).
 *   2. Create or reuse a channel.
 *   3. List the latest 30 messages.
 *   4. Send 3 messages with random content.
 *   5. Mark the channel as read.
 *
 * Each step has a short think-time sleep to mimic human pacing.
 *
 * @returns {string|null} the channel id used (for follow-up calls)
 */
export function simulateCustomerChatSession() {
  listChannels();
  sleep(0.3);

  const ch = createChannel();
  if (ch.status !== 200) return null;
  let channelId;
  try {
    channelId = ch.json('channel.id');
  } catch {
    return null;
  }
  if (!channelId) return null;

  listMessages(channelId, 30, 0);
  sleep(0.5);

  for (let i = 0; i < 3; i++) {
    sendMessage(channelId);
    sleep(0.8);
  }

  markRead(channelId);
  return channelId;
}
