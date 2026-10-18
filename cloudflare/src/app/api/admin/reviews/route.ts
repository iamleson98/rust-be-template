import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/**
 * `GET /api/admin/reviews?status=&brandId=&routeId=&search=&limit=&offset=`
 * — moderation queue. Returns the public `ReviewOut` shape plus the
 * author's name/phone for staff follow-up.
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:reviews:moderate");
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? undefined;
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const routeId = url.searchParams.get("routeId") ?? undefined;
    const search = url.searchParams.get("search")?.trim() || undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    const rows = await rawAll<Record<string, unknown>>(sql`
      SELECT r.*,
             (SELECT u.full_name FROM "user" u WHERE u.id = r.user_id) AS author_name,
             (SELECT u.phone FROM "user" u WHERE u.id = r.user_id) AS author_phone,
             (SELECT COUNT(*) FROM review r2
               WHERE 1=1
                 ${status ? sql`AND r2.status = ${status}` : sql``}
                 ${brandId ? sql`AND r2.brand_id = ${brandId}` : sql``}
                 ${routeId ? sql`AND r2.route_id = ${routeId}` : sql``}
                 ${search ? sql`AND (r2.title LIKE ${"%" + search + "%"} OR r2.content LIKE ${"%" + search + "%"})` : sql``}
             ) AS total
      FROM review r
      WHERE 1=1
        ${status ? sql`AND r.status = ${status}` : sql``}
        ${brandId ? sql`AND r.brand_id = ${brandId}` : sql``}
        ${routeId ? sql`AND r.route_id = ${routeId}` : sql``}
        ${search ? sql`AND (r.title LIKE ${"%" + search + "%"} OR r.content LIKE ${"%" + search + "%"})` : sql``}
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return Response.json({
      items: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        authorName: r.author_name,
        authorPhone: r.author_phone,
        bookingId: r.booking_id,
        brandId: r.brand_id,
        routeId: r.route_id,
        tripSessionId: r.trip_session_id,
        rating: r.rating,
        title: r.title,
        content: r.content,
        tags: JSON.parse((r.tags as string) ?? "[]"),
        photos: JSON.parse((r.photos as string) ?? "[]"),
        status: r.status,
        reply: r.reply,
        repliedAt: r.replied_at,
        helpfulCount: r.helpful_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total: Number(rows[0]?.total ?? 0),
      limit,
      offset,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
