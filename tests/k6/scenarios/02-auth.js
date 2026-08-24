/**
 * 02-auth.js — authentication load test.
 *
 * Hammers the auth endpoints:
 *   - register (creates a new user per VU/iteration — heavy on DB writes)
 *   - login (existing user — read-heavy)
 *   - refresh (token rotation — JWT sign + DB write)
 *   - me (cheap auth check — single DB lookup)
 *   - logout (revokes refresh tokens — DB write)
 *
 * ## Scenario mix
 *
 * 50% of iterations register a NEW user (heavy write path).
 * 30% login as an existing user (read path).
 * 20% refresh + me + logout (token rotation cycle).
 *
 * ## Prerequisites
 *
 * For the login path, set `USER_EMAIL` + `USER_PASSWORD` env vars to
 * an existing customer account. If unset, the login check will fail
 * but the register path still works.
 *
 * Run:
 *   k6 run tests/k6/scenarios/02-auth.js
 *
 * With existing user:
 *   k6 run -e USER_EMAIL=test@example.com -e USER_PASSWORD=Pass123! \
 *     tests/k6/scenarios/02-auth.js
 */

import { sleep } from 'k6';
import { register, login, refresh, me, logout } from '../helpers/auth.js';
import { resetJar } from '../config.js';

export const options = {
  stages: [
    { duration: '20s', target: 10 },   // ramp up
    { duration: '40s', target: 10 },   // hold
    { duration: '20s', target: 30 },   // ramp up more
    { duration: '40s', target: 30 },   // hold
    { duration: '20s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<2000'],
    http_req_failed: ['rate<0.05'],  // allow some 409s on register collisions
  },
};

export default function () {
  const roll = Math.random();

  if (roll < 0.5) {
    // 50% — register a new user (heavy write).
    resetJar();  // start with a clean session
    register();
    sleep(0.3);
    me();  // verify the session
  } else if (roll < 0.8) {
    // 30% — login as existing user (read).
    resetJar();
    login();
    sleep(0.2);
    me();
  } else {
    // 20% — token rotation cycle.
    resetJar();
    login();
    sleep(0.2);
    refresh();  // rotate access token
    sleep(0.1);
    me();  // verify new token works
    sleep(0.2);
    logout();  // revoke
  }

  sleep(0.5);  // think time
}
