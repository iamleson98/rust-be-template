/**
 * Access-token revocation (Rust `auth/jwt_validator.rs`).
 *
 * Refresh tokens live in D1 and are revoked there. An access token is a signed
 * JWT, so "log out" and "log out everywhere" need a deny-list that is only
 * useful until the token would have expired anyway:
 *
 *  - one token  → key `jwt:revoked:<sha256(token)>`
 *  - one user   → key `jwt:user-revoked:<uid>` holding the revocation time; any
 *                 token of that user with `iat <= time` is rejected (`<=`, so a
 *                 login and a logout in the same second still revokes it)
 *
 * Rust keeps both in process memory (moka, TTL = access TTL), which is lost on
 * every restart and not shared between instances. KV is shared by every
 * isolate, so this is strictly stronger; it is eventually consistent (a
 * revocation can take up to ~60 s to reach another location), bounded by the
 * 15-minute access lifetime. Without the `CACHE_KV` binding nothing is
 * revoked, like a freshly restarted Rust process.
 */
import { getEnv } from "@/lib/db/client";
import { JWT_LEEWAY_SECS, accessTtlSecs, type AccessClaims } from "./jwt";
import { sha256Hex } from "./crypto";

/** KV refuses a TTL below 60 s. */
const KV_MIN_TTL = 60;

const tokenKey = async (token: string) => `jwt:revoked:${await sha256Hex(token)}`;
const userKey = (userId: string) => `jwt:user-revoked:${userId}`;

export async function revokeAccessToken(token: string, claims: AccessClaims): Promise<void> {
  const kv = (await getEnv()).CACHE_KV;
  if (!kv) return;
  const left = claims.exp + JWT_LEEWAY_SECS - Math.floor(Date.now() / 1000);
  await kv.put(await tokenKey(token), "1", { expirationTtl: Math.max(KV_MIN_TTL, left) });
}

/** Rejects every access token the user holds right now ("log out on all devices"). */
export async function revokeAllAccessTokens(userId: string): Promise<void> {
  const kv = (await getEnv()).CACHE_KV;
  if (!kv) return;
  await kv.put(userKey(userId), String(Math.floor(Date.now() / 1000)), {
    expirationTtl: Math.max(KV_MIN_TTL, (await accessTtlSecs()) + JWT_LEEWAY_SECS),
  });
}

/** One KV round trip for both deny-lists. */
export async function isAccessTokenRevoked(token: string, claims: AccessClaims): Promise<boolean> {
  const kv = (await getEnv()).CACHE_KV;
  if (!kv) return false;
  const [byToken, byUser] = [await tokenKey(token), userKey(claims.sub)];
  const hits = await kv.get([byToken, byUser]);
  if (hits.get(byToken)) return true;
  const revokedAt = Number(hits.get(byUser));
  return Number.isFinite(revokedAt) && revokedAt > 0 && claims.iat <= revokedAt;
}
