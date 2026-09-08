/**
 * 03-chat-validation.js — SHORT post-deploy validation of the v0.3.5
 * engine fixes (page-cache capacity, tx ledger, total_changes).
 *
 * Same flow as scenarios/03-chat.js but a fraction of the load:
 * 5 VUs for ~45s. Enough to warm the (now correctly sized) page cache
 * and drive a few hundred auto-commit writes through the exact path
 * the full test uses. Run:
 *   k6 run tests/k6/scenarios/03-chat-validation.js
 */

import { sleep } from 'k6';
import { register, me } from '../helpers/auth.js';
import {
  listChannels,
  createChannel,
  listMessages,
  sendMessage,
  markRead,
} from '../helpers/chat.js';

export const options = {
  scenarios: {
    chat_validation: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },
        { duration: '30s', target: 5 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    http_req_failed: ['rate<0.02'],
  },
};

const vuRegistered = new Map();

export default function () {
  if (!vuRegistered.has(__VU)) {
    const reg = register();
    if (reg.status === 200) {
      vuRegistered.set(__VU, true);
      sleep(0.3);
      me();
    }
    return;
  }

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

  listMessages(channelId, 30, 0);
  sleep(0.2);
  listMessages(channelId, 30, 30);
  sleep(0.2);

  for (let i = 0; i < 3; i++) {
    sendMessage(channelId, `v0.3.5 validation ${__VU}-${__ITER}-${i}`);
    sleep(0.2);
  }

  markRead(channelId);
  sleep(0.5);
}
