/**
 * Admin coupon ledger and payouts — `GET /api/admin/coupons`,
 * `POST /api/admin/coupons/{id}/reject`, `POST /api/admin/coupons/settle`
 * and `GET /api/admin/coupons/payouts`.
 *
 * Paying a brand for a coupon is final, so the two writes change a coupon
 * only while it is still `redeemed` (one conditional UPDATE each): a coupon
 * settled a moment earlier can no longer be turned into a rejection.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import { getDb, rawAll, rawRun } from "@/lib/db/client";
import { bookings, brands, coupons, discountCampaigns, users } from "@/lib/db/schema";
import { couponViews } from "../coupons";
import { badRequest, conflict, notFound } from "../http-errors";
import { isRecord } from "../input";

/**
 * The ledger, newest claim first, with what to check before paying: the
 * owner, the booking, and how many coupons share the claim's network or
 * account.
 */
export async function adminCouponList(f: {
  campaignId?: string;
  brandId?: string;
  status?: string;
  limit: number;
  offset: number;
}) {
  const where = and(
    f.campaignId ? eq(coupons.campaignId, f.campaignId) : undefined,
    f.brandId ? eq(coupons.brandId, f.brandId) : undefined,
    f.status ? eq(coupons.status, f.status) : undefined,
  );
  const db = await getDb();
  const [rows, [total]] = await Promise.all([
    db
      .select({
        coupon: coupons,
        campaignName: discountCampaigns.name,
        ownerName: users.fullName,
        ownerPhone: users.phone,
        ownerCreatedAt: users.createdAt,
        bookingCode: bookings.code,
        brandName: brands.name,
        brandSlug: brands.slug,
        // Correlated: they reference the outer row's own claim_ip / user_id.
        sharedIp: sql<number>`(SELECT COUNT(*) FROM ${coupons} c2 WHERE c2.claim_ip = ${coupons.claimIp} AND c2.claim_ip IS NOT NULL)`,
        sharedPhone: sql<number>`(SELECT COUNT(*) FROM ${coupons} c3 WHERE c3.user_id = ${coupons.userId})`,
      })
      .from(coupons)
      .leftJoin(discountCampaigns, eq(discountCampaigns.id, coupons.campaignId))
      .leftJoin(users, eq(users.id, coupons.userId))
      .leftJoin(bookings, eq(bookings.id, coupons.bookingId))
      .leftJoin(brands, eq(brands.id, coupons.brandId))
      .where(where)
      .orderBy(desc(coupons.claimedAt))
      .limit(f.limit)
      .offset(f.offset),
    db.select({ n: count() }).from(coupons).where(where),
  ]);
  return {
    items: rows.map((r) => {
      const c = r.coupon;
      return {
        id: c.id,
        code: c.code,
        campaignId: c.campaignId,
        campaignName: r.campaignName,
        amount: c.amount,
        status: c.status,
        claimedAt: c.claimedAt,
        redeemedAt: c.redeemedAt,
        settledAt: c.settledAt,
        settlementNote: c.settlementNote,
        newAccount: r.ownerCreatedAt !== null && r.ownerCreatedAt > c.claimedAt.slice(0, 10),
        owner:
          r.ownerName !== null || r.ownerPhone !== null
            ? { name: r.ownerName, phone: r.ownerPhone }
            : null,
        booking: r.bookingCode !== null ? { id: c.bookingId, code: r.bookingCode } : null,
        brand:
          r.brandName !== null ? { id: c.brandId, name: r.brandName, slug: r.brandSlug } : null,
        sharedIp: Number(r.sharedIp ?? 0),
        sharedPhone: Number(r.sharedPhone ?? 0),
      };
    }),
    total: Number(total?.n ?? 0),
  };
}

/** Refuse to pay a redeemed coupon, with the reason staff will read later. */
export async function rejectCoupon(id: string, rawReason: unknown) {
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (!reason) throw badRequest("a rejection reason is required");
  if (reason.length > 500) throw badRequest("the reason must be at most 500 characters");
  const now = new Date().toISOString();
  const res = await rawRun(sql`
    UPDATE coupon SET status = 'rejected', settlement_note = ${reason}, updated_at = ${now}
     WHERE id = ${id} AND status = 'redeemed'
  `);
  if (!res.meta.changes) {
    const [row] = await rawAll<{ id: string }>(sql`SELECT id FROM coupon WHERE id = ${id}`);
    if (!row) throw notFound("coupon not found");
    throw conflict("only redeemed coupons can be rejected");
  }
  const [out] = await couponViews(sql`c.id = ${id}`);
  return out;
}

/**
 * Mark redeemed coupons as paid out: one brand's, or everyone's when the body
 * is absent or empty. A body that is there but malformed is a 400: it used to
 * fall through to "settle everything".
 */
export async function settleCoupons(body: unknown): Promise<{ settled: number }> {
  let brandId: string | undefined;
  if (body !== undefined && body !== null) {
    if (!isRecord(body)) throw badRequest("body must be a JSON object");
    if (body.brandId !== undefined) {
      if (typeof body.brandId !== "string" || !body.brandId)
        throw badRequest("brandId must be a brand id");
      brandId = body.brandId;
    }
  }
  const now = new Date().toISOString();
  const res = await rawRun(sql`
    UPDATE coupon SET status = 'settled', settled_at = ${now}, settlement_note = 'settle-by-admin'
     WHERE status = 'redeemed' ${brandId !== undefined ? sql`AND brand_id = ${brandId}` : sql``}
  `);
  return { settled: res.meta.changes ?? 0 };
}

/** What each brand is owed and has been paid for redeemed coupons, most owed first. */
export async function couponPayouts() {
  const rows = await rawAll<{
    brand_id: string | null;
    brand_name: string | null;
    brand_slug: string | null;
    owed_count: number | null;
    owed_amount: number | null;
    paid_count: number | null;
    paid_amount: number | null;
  }>(sql`
    SELECT c.brand_id, br.name AS brand_name, br.slug AS brand_slug,
           SUM(CASE WHEN c.status = 'redeemed' THEN 1 ELSE 0 END) AS owed_count,
           SUM(CASE WHEN c.status = 'redeemed' THEN c.amount ELSE 0 END) AS owed_amount,
           SUM(CASE WHEN c.status = 'settled' THEN 1 ELSE 0 END) AS paid_count,
           SUM(CASE WHEN c.status = 'settled' THEN c.amount ELSE 0 END) AS paid_amount
      FROM coupon c
      LEFT JOIN brand br ON br.id = c.brand_id
     WHERE c.status IN ('redeemed', 'settled')
     GROUP BY c.brand_id, br.name, br.slug
     ORDER BY owed_amount DESC
  `);
  const items = rows.map((r) => ({
    brand: r.brand_id ? { id: r.brand_id, name: r.brand_name, slug: r.brand_slug } : null,
    owedCount: Number(r.owed_count ?? 0),
    owedAmount: Number(r.owed_amount ?? 0),
    paidCount: Number(r.paid_count ?? 0),
    paidAmount: Number(r.paid_amount ?? 0),
  }));
  return {
    items,
    totalOwed: items.reduce((s, r) => s + r.owedAmount, 0),
    totalPaid: items.reduce((s, r) => s + r.paidAmount, 0),
  };
}
