import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";

/**
 * `GET /api/admin/coupons?campaignId=&brandId=&status=&limit=&offset=`
 * — coupon audit list (Rust `AdminCouponListResponse`): owner + brand +
 * booking previews, shared-IP/phone counters, settlement info.
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) {
      // employees may still read the coupon ledger for support
    }
    const url = new URL(req.url);
    const campaignId = url.searchParams.get("campaignId") ?? undefined;
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    const rows = await rawAll<Record<string, unknown>>(sql`
      SELECT c.id, c.code, c.campaign_id, c.amount, c.status, c.claimed_at,
             c.redeemed_at, c.settled_at, c.settlement_note, c.booking_id, c.brand_id,
             (SELECT dc.name FROM discount_campaign dc WHERE dc.id = c.campaign_id) AS campaign_name,
             (SELECT u.full_name FROM "user" u WHERE u.id = c.user_id) AS owner_name,
             (SELECT u.phone FROM "user" u WHERE u.id = c.user_id) AS owner_phone,
             (SELECT u.created_at FROM "user" u WHERE u.id = c.user_id) AS owner_created_at,
             (SELECT b.code FROM booking b WHERE b.id = c.booking_id) AS booking_code,
             (SELECT br.name FROM brand br WHERE br.id = c.brand_id) AS brand_name,
             (SELECT br.slug FROM brand br WHERE br.id = c.brand_id) AS brand_slug,
             (SELECT COUNT(*) FROM coupon c2 WHERE c2.claim_ip = c.claim_ip AND c2.claim_ip IS NOT NULL) AS shared_ip,
             (SELECT COUNT(*) FROM coupon c3 WHERE c3.user_id = c.user_id) AS shared_phone,
             (SELECT COUNT(*) FROM coupon c4 WHERE 1=1
                ${campaignId ? sql`AND c4.campaign_id = ${campaignId}` : sql``}
                ${brandId ? sql`AND c4.brand_id = ${brandId}` : sql``}
                ${status ? sql`AND c4.status = ${status}` : sql``}
             ) AS total
      FROM coupon c
      WHERE 1=1
        ${campaignId ? sql`AND c.campaign_id = ${campaignId}` : sql``}
        ${brandId ? sql`AND c.brand_id = ${brandId}` : sql``}
        ${status ? sql`AND c.status = ${status}` : sql``}
      ORDER BY c.claimed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return Response.json({
      items: rows.map((c) => ({
        id: c.id,
        code: c.code,
        campaignId: c.campaign_id,
        campaignName: c.campaign_name,
        amount: c.amount,
        status: c.status,
        claimedAt: c.claimed_at,
        redeemedAt: c.redeemed_at,
        settledAt: c.settled_at,
        settlementNote: c.settlement_note,
        newAccount: !!c.owner_created_at && String(c.owner_created_at) > String(c.claimed_at).slice(0, 10),
        owner: c.owner_name || c.owner_phone
          ? { name: c.owner_name, phone: c.owner_phone }
          : null,
        booking: c.booking_code ? { id: c.booking_id, code: c.booking_code } : null,
        brand: c.brand_name ? { id: c.brand_id, name: c.brand_name, slug: c.brand_slug } : null,
        sharedIp: Number(c.shared_ip ?? 0),
        sharedPhone: Number(c.shared_phone ?? 0),
      })),
      total: Number(rows[0]?.total ?? 0),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
