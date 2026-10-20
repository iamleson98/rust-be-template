/**
 * Claiming a coupon — the port of Rust `CampaignService::claim` and
 * `CampaignStore::claim` (`docs/CAMPAIGNS.md`, "Claiming without overselling").
 *
 * Rust does the check-and-take inside one store transaction. D1 has no
 * interactive transaction, so the same guarantee is built from a single
 * `batch()` (one implicit transaction): the coupon is inserted by an
 * `INSERT … SELECT` that only produces a row when every rule still holds
 * (campaign running, nothing held, nothing claimed from it, a slot left),
 * and the slot is taken by an `UPDATE` that only fires for the coupon just
 * inserted. A unique-index violation (a racing claim of the same account,
 * or a code collision) aborts the whole batch, so no slot ever leaks and
 * nothing needs compensating. The reads before it only pick the precise
 * error; they are never trusted for the write.
 */
import { eq, sql } from "drizzle-orm";
import { atomicBatch, getDb, rawAll, rawRun } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  CAMPAIGN_CODES,
  couponBadRequest,
  couponConflict,
  couponForbidden,
  couponGone,
} from "@/lib/services/campaign-codes";
import { couponOut } from "@/lib/services/campaign-out";
import { invalidateCampaigns, noteRemaining } from "@/lib/services/campaign-public";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * A readable coupon code: `DXV` + 7 characters without 0/O/1/I. 32 symbols
 * divide 256 evenly, so a masked random byte is unbiased.
 */
export function newCouponCode(): string {
  const bytes = new Uint8Array(7);
  crypto.getRandomValues(bytes);
  let tail = "";
  for (const b of bytes) tail += CODE_ALPHABET[b & 31];
  return `DXV${tail}`;
}

type Outcome =
  | { kind: "claimed"; couponId: string; remaining: number }
  | { kind: "error"; error: ReturnType<typeof couponBadRequest> }
  | { kind: "raced" };

/** Why a claim cannot go ahead right now, in Rust's order; null if it can. */
async function refusal(userId: string, campaignId: string, tierId: string, now: string) {
  const state = await rawAll<{
    running: number | null;
    holding: number;
    claimed: number;
    tier_exists: number;
    sold_out: number;
  }>(sql`
    SELECT
      (SELECT 1 FROM discount_campaign WHERE id = ${campaignId} AND paused = 0
         AND starts_at <= ${now} AND ${now} < ends_at) AS running,
      EXISTS (SELECT 1 FROM coupon WHERE active_holder = ${userId}) AS holding,
      EXISTS (SELECT 1 FROM coupon WHERE campaign_id = ${campaignId} AND user_id = ${userId}) AS claimed,
      EXISTS (SELECT 1 FROM discount_tier WHERE id = ${tierId} AND campaign_id = ${campaignId}) AS tier_exists,
      EXISTS (SELECT 1 FROM discount_tier WHERE id = ${tierId} AND campaign_id = ${campaignId}
                AND claimed_slots >= total_slots) AS sold_out
  `);
  const s = state[0];
  if (!s.running) return { code: CAMPAIGN_CODES.NOT_RUNNING, error: couponBadRequest };
  if (s.holding) return { code: CAMPAIGN_CODES.ALREADY_HELD, error: couponConflict };
  if (s.claimed) return { code: CAMPAIGN_CODES.ALREADY_CLAIMED, error: couponConflict };
  if (!s.tier_exists) return { code: CAMPAIGN_CODES.NOT_RUNNING, error: couponBadRequest };
  if (s.sold_out) return { code: CAMPAIGN_CODES.SOLD_OUT, error: couponGone };
  return null;
}

async function attempt(
  userId: string,
  claimIp: string | null,
  campaignId: string,
  tierId: string,
): Promise<Outcome> {
  const now = new Date().toISOString();
  // Lazy expiry of the caller's stale held coupons, so an ended window never
  // locks the account out until the nightly job runs.
  await rawRun(sql`
    UPDATE coupon SET status = 'expired', active_holder = NULL, updated_at = ${now}
    WHERE active_holder = ${userId} AND status = 'held'
      AND valid_until IS NOT NULL AND valid_until <= ${now}
  `);

  const refused = await refusal(userId, campaignId, tierId, now);
  if (refused) return { kind: "error", error: refused.error(refused.code) };

  const couponId = crypto.randomUUID();
  let results;
  try {
    results = await atomicBatch<{ remaining: number | null }>([
      sql`
        INSERT INTO coupon (id, code, campaign_id, tier_id, user_id, amount, status,
                            active_holder, valid_until, claim_ip, claimed_at, updated_at)
        SELECT ${couponId}, ${newCouponCode()}, c.id, t.id, ${userId}, t.amount, 'held',
               ${userId}, CASE WHEN c.coupon_validity = 'campaign' THEN c.ends_at END,
               ${claimIp}, ${now}, ${now}
        FROM discount_tier t JOIN discount_campaign c ON c.id = t.campaign_id
        WHERE t.id = ${tierId} AND c.id = ${campaignId}
          AND c.paused = 0 AND c.starts_at <= ${now} AND ${now} < c.ends_at
          AND t.claimed_slots < t.total_slots
          AND NOT EXISTS (SELECT 1 FROM coupon WHERE active_holder = ${userId})
          AND NOT EXISTS (SELECT 1 FROM coupon WHERE campaign_id = ${campaignId} AND user_id = ${userId})
      `,
      sql`
        UPDATE discount_tier SET claimed_slots = claimed_slots + 1
        WHERE id = ${tierId} AND EXISTS (SELECT 1 FROM coupon WHERE id = ${couponId})
      `,
      // Exact: D1 runs the batch as one transaction, so nobody changed the
      // tier between the UPDATE above and this read.
      sql`
        SELECT t.total_slots - t.claimed_slots AS remaining
        FROM discount_tier t WHERE t.id = ${tierId}
          AND EXISTS (SELECT 1 FROM coupon WHERE id = ${couponId})
      `,
    ]);
  } catch (e) {
    // A racing claim of the same account (or a code collision) hit a unique
    // index; the batch rolled back, so the state is fresh on the next try.
    if (isUniqueViolation(e)) return { kind: "raced" };
    throw e;
  }
  const remaining = results[2]?.results?.[0]?.remaining;
  // No row: the state changed between the reads above and the batch.
  if (remaining === undefined || remaining === null) return { kind: "raced" };
  return { kind: "claimed", couponId, remaining };
}

/** drizzle wraps D1 errors; the UNIQUE text can sit on `cause`. */
function isUniqueViolation(e: unknown): boolean {
  const err = e as { message?: string; cause?: { message?: string } };
  return /UNIQUE constraint failed/i.test(`${err?.message ?? ""} ${err?.cause?.message ?? ""}`);
}

/**
 * Claim a slot of `tierId` for `userId`. Customers only; one held coupon at a
 * time and one per campaign. Errors are `ApiError`s whose message is the
 * stable code the apps translate.
 */
export async function claimCoupon(
  userId: string,
  claimIp: string | null,
  campaignId: string,
  tierId: string,
) {
  const db = await getDb();
  const user = (
    await db
      .select({
        role: users.role,
        isGuest: users.isGuest,
        isBot: users.isBot,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  // Staff and admins cannot award themselves coupons; bots, guests and
  // blocked accounts cannot claim either.
  if (!user || user.role !== "user" || user.isGuest || user.isBot || user.status !== "active")
    throw couponForbidden(CAMPAIGN_CODES.CUSTOMERS_ONLY);

  const ip = claimIp ? claimIp.slice(0, 64) : null;
  let outcome: Outcome = { kind: "raced" };
  for (let tries = 1; tries <= 2 && outcome.kind === "raced"; tries++) {
    outcome = await attempt(userId, ip, campaignId, tierId);
  }
  if (outcome.kind === "raced") throw couponConflict(CAMPAIGN_CODES.TRY_AGAIN);
  if (outcome.kind === "error") {
    if (outcome.error.message === CAMPAIGN_CODES.SOLD_OUT) await invalidateCampaigns();
    throw outcome.error;
  }

  if (outcome.remaining <= 0) await invalidateCampaigns();
  else noteRemaining(tierId, outcome.remaining);
  const out = await couponOut(outcome.couponId);
  if (!out) throw couponConflict(CAMPAIGN_CODES.TRY_AGAIN); // unreachable: just inserted
  return out;
}
