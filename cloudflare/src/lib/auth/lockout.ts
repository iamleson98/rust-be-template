/**
 * Password-guessing lockout, stored in D1 (`user.failed_login_attempts`,
 * `user.locked_until`). Unlike the Workers rate-limit binding this is exact
 * and durable, so it is the guard that actually bounds online guessing.
 *
 * MAX_FAILED_ATTEMPTS consecutive wrong passwords lock the account for
 * LOCK_MINUTES. A correct password (or a password change) clears the count, in
 * the same UPDATE those routes already issue.
 * An expired lock restarts the count at the next failure.
 *
 * Trade-off, accepted: anyone who knows an email can lock that account for
 * LOCK_MINUTES by failing five times. That is the price of an exact bound on
 * guessing; OAuth / refresh-token sessions are unaffected, and the edge rate
 * limit on /api/auth/login keeps the lock from being re-armed at scale.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { ApiError } from "@/lib/auth/rbac";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

interface LockState {
  failedLoginAttempts: number;
  lockedUntil: string | null;
}

/** Seconds of lock remaining (0 when unlocked or the lock has expired). */
export function lockRemainingSecs(u: LockState, nowMs = Date.now()): number {
  if (!u.lockedUntil) return 0;
  return Math.max(0, Math.ceil((new Date(u.lockedUntil).getTime() - nowMs) / 1000));
}

/** Throws 429 while the account is locked. Same shape for any account. */
export function assertNotLocked(u: LockState): void {
  const left = lockRemainingSecs(u);
  if (left > 0) {
    throw new ApiError(
      429,
      "account-locked",
      "Too many failed sign-in attempts — try again later or reset your password",
      left,
    );
  }
}

/**
 * Records a wrong password. One atomic UPDATE: the count, the lock decision
 * and the expired-lock restart are all computed from the row's own values, so
 * concurrent guesses cannot slip past the limit.
 */
export async function recordFailedLogin(userId: string): Promise<LockState> {
  const db = await getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const until = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  // Attempts counted so far, ignoring a lock that has already run out.
  const base = sql`(CASE WHEN ${users.lockedUntil} IS NOT NULL AND ${users.lockedUntil} <= ${nowIso}
    THEN 0 ELSE ${users.failedLoginAttempts} END)`;
  const rows = await db
    .update(users)
    .set({
      failedLoginAttempts: sql`${base} + 1`,
      lockedUntil: sql`(CASE WHEN ${base} + 1 >= ${MAX_FAILED_ATTEMPTS} THEN ${until} ELSE NULL END)`,
    })
    .where(eq(users.id, userId))
    .returning({
      failedLoginAttempts: users.failedLoginAttempts,
      lockedUntil: users.lockedUntil,
    });
  return rows[0] ?? { failedLoginAttempts: 0, lockedUntil: null };
}
