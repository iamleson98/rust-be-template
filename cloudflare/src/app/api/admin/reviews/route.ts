import { getDb } from "@/lib/db/client";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { reviews, users } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

function parseJsonArray(raw: string | null): unknown[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * `GET /api/admin/reviews?status=&brandId=&routeId=&search=&limit=&offset=`
 * — moderation queue. Returns the public `ReviewOut` shape plus the
 * author's name/phone for staff follow-up. Page + total are two typed
 * builder queries sharing one WHERE (no conditional SQL strings).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:reviews:moderate");
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const brandId = url.searchParams.get("brandId");
    const routeId = url.searchParams.get("routeId");
    const search = url.searchParams.get("search")?.trim();
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
      100,
    );
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    const where = and(
      status != null ? eq(reviews.status, status) : undefined,
      brandId != null ? eq(reviews.brandId, brandId) : undefined,
      routeId != null ? eq(reviews.routeId, routeId) : undefined,
      search != null && search.length > 0
        ? or(like(reviews.title, `%${search}%`), like(reviews.content, `%${search}%`))
        : undefined,
    );

    const db = await getDb();
    const rows = await db
      .select({ review: reviews, authorName: users.fullName, authorPhone: users.phone })
      .from(reviews)
      .leftJoin(users, eq(users.id, reviews.userId))
      .where(where)
      .orderBy(desc(reviews.createdAt))
      .limit(limit)
      .offset(offset);
    const totalRows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(reviews)
      .where(where);
    const total = totalRows[0]?.count ?? 0;

    return Response.json({
      items: rows.map(({ review: r, authorName, authorPhone }) => ({
        id: r.id,
        userId: r.userId,
        authorName,
        authorPhone,
        bookingId: r.bookingId,
        brandId: r.brandId,
        routeId: r.routeId,
        tripSessionId: r.tripSessionId,
        rating: r.rating,
        title: r.title,
        content: r.content,
        tags: parseJsonArray(r.tags),
        photos: parseJsonArray(r.photos),
        status: r.status,
        reply: r.reply,
        repliedAt: r.repliedAt,
        helpfulCount: r.helpfulCount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      total,
      limit,
      offset,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
