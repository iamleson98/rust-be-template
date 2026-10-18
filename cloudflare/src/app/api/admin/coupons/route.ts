import { getDb } from "@/lib/db/client";
import { and, desc, eq, sql } from "drizzle-orm";
import { bookings, brands, coupons, discountCampaigns, users } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";

/**
 * `GET /api/admin/coupons?campaignId=&brandId=&status=&limit=&offset=`
 * — coupon audit list (Rust `AdminCouponListResponse`): owner + brand +
 * booking previews, shared-IP/phone counters, settlement info. Typed
 * builder joins; the two shared-usage counters stay as correlated
 * fragments (they reference the outer row's own claim_ip/user_id).
 */
export async function GET(req: Request) {
  try {
    // Rust requires admin; employees here may also read the ledger for
    // support follow-ups, so there is no role rejection on this path —
    // but the request must still carry a valid staff session.
    await requireStaff(req);
    const url = new URL(req.url);
    const campaignId = url.searchParams.get("campaignId");
    const brandId = url.searchParams.get("brandId");
    const status = url.searchParams.get("status");
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
      100,
    );
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    const where = and(
      campaignId != null ? eq(coupons.campaignId, campaignId) : undefined,
      brandId != null ? eq(coupons.brandId, brandId) : undefined,
      status != null ? eq(coupons.status, status) : undefined,
    );

    const db = await getDb();
    const rows = await db
      .select({
        coupon: coupons,
        campaignName: discountCampaigns.name,
        ownerName: users.fullName,
        ownerPhone: users.phone,
        ownerCreatedAt: users.createdAt,
        bookingCode: bookings.code,
        brandName: brands.name,
        brandSlug: brands.slug,
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
      .limit(limit)
      .offset(offset);
    const totalRows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(coupons)
      .where(where);
    const total = totalRows[0]?.count ?? 0;

    return Response.json({
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
      total,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
