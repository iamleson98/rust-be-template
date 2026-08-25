/**
 * auth.js — authentication helpers for k6 tests.
 *
 * Wraps the backend's auth endpoints with k6's check + cookie jar so
 * scenarios can focus on business logic instead of repeating login
 * boilerplate.
 *
 * ## Endpoints covered
 *
 *   POST /api/auth/register        — create a new customer account
 *   POST /api/auth/login           — login as an existing customer
 *   POST /api/auth/employee-login  — login as an employee (admin)
 *   POST /api/auth/refresh         — rotate the access token
 *   POST /api/auth/logout          — revoke all refresh tokens + clear cookies
 *   GET  /api/auth/me              — fetch the current session user
 *
 * All mutations set httpOnly cookies (`access_token`, `refresh_token`)
 * on the VU's cookie jar — subsequent authenticated requests pick
 * them up automatically via `withAuth()`.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, withAuth, uniqueEmail, uniquePhone } from '../config.js';

/**
 * Register a new customer account.
 *
 * Generates a unique email + phone per VU/iteration so concurrent
 * registrations don't collide on the UNIQUE constraints. The
 * resulting `access_token` cookie is stored on the VU's jar.
 *
 * @param {object} [overrides] — override default fields (e.g. custom email)
 * @returns {object} the k6 response (check `res.status === 200` + `res.json().user.id`)
 */
export function register(overrides = {}) {
  const body = {
    fullName: `K6 User ${__VU}-${__ITER}`,
    email: uniqueEmail(),
    phone: uniquePhone(),
    password: 'LoadTest123!',
    ...overrides,
  };
  const res = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify(body),
    withAuth(),
  );
  check(res, {
    'register status 200': (r) => r.status === 200,
    'register has user': (r) => {
      try {
        return r.json('user.id') !== null && r.json('user.id') !== undefined;
      } catch {
        return false;
      }
    },
    'register sets access_token cookie': (r) =>
      r.cookies.access_token !== undefined && r.cookies.access_token.length > 0,
  });
  return res;
}

/**
 * Login as an existing customer.
 *
 * Uses `USER_EMAIL` + `USER_PASSWORD` from the environment by default.
 * Override via the `email` + `password` args.
 *
 * @param {string} [email] — defaults to `__ENV.USER_EMAIL`
 * @param {string} [password] — defaults to `__ENV.USER_PASSWORD`
 * @returns {object} the k6 response
 */
export function login(email, password) {
  const body = {
    email: email || __ENV.USER_EMAIL,
    password: password || __ENV.USER_PASSWORD,
  };
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify(body),
    withAuth(),
  );
  check(res, {
    'login status 200': (r) => r.status === 200,
    'login has user': (r) => {
      try {
        return r.json('user.id') !== null && r.json('user.id') !== undefined;
      } catch {
        return false;
      }
    },
    'login sets access_token cookie': (r) =>
      r.cookies.access_token !== undefined && r.cookies.access_token.length > 0,
  });
  return res;
}

/**
 * Login as an employee (admin).
 *
 * Uses `ADMIN_EMAIL` + `ADMIN_PASSWORD` from the environment by default.
 * The backend rejects non-employee accounts with 403 on this endpoint.
 *
 * @param {string} [email] — defaults to `__ENV.ADMIN_EMAIL`
 * @param {string} [password] — defaults to `__ENV.ADMIN_PASSWORD`
 * @returns {object} the k6 response
 */
export function employeeLogin(email, password) {
  const body = {
    email: email || __ENV.ADMIN_EMAIL,
    password: password || __ENV.ADMIN_PASSWORD,
  };
  const res = http.post(
    `${BASE_URL}/api/auth/employee-login`,
    JSON.stringify(body),
    withAuth(),
  );
  check(res, {
    'employee-login status 200': (r) => r.status === 200,
    'employee-login user is employee': (r) => {
      try {
        return r.json('user.type') === 'employee' || r.json('user.role') === 'employee';
      } catch {
        return false;
      }
    },
  });
  return res;
}

/**
 * Refresh the access token using the httpOnly `refresh_token` cookie.
 *
 * The backend reads the cookie first, falling back to the body if the
 * cookie is missing. We pass an empty body — the cookie jar handles it.
 *
 * @returns {object} the k6 response (200 = new access_token issued)
 */
export function refresh() {
  const res = http.post(
    `${BASE_URL}/api/auth/refresh`,
    JSON.stringify({}),
    withAuth(),
  );
  check(res, {
    'refresh status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Logout — revokes all refresh tokens server-side + clears the
 * auth cookies. After this, the VU's jar no longer has valid
 * credentials.
 *
 * @returns {object} the k6 response (200 = logout succeeded)
 */
export function logout() {
  const res = http.post(`${BASE_URL}/api/auth/logout`, null, withAuth());
  check(res, {
    'logout status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Fetch the current session user.
 *
 * Used as a "ping" endpoint for authenticated scenarios — it's
 * cheap (single DB lookup) + verifies the access_token is still valid.
 *
 * @returns {object} the k6 response (200 = valid session)
 */
export function me() {
  const res = http.get(`${BASE_URL}/api/auth/me`, withAuth());
  check(res, {
    'me status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Convenience: register + immediately verify the session via /me.
 * Returns the user id (or null on failure).
 *
 * @returns {string|null} the new user's UUID
 */
export function registerAndVerify() {
  const reg = register();
  if (reg.status !== 200) return null;
  sleep(0.1); // give the DB a moment to commit
  const meRes = me();
  if (meRes.status !== 200) return null;
  try {
    return meRes.json('user.id');
  } catch {
    return null;
  }
}
