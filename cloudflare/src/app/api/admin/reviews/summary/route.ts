import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/**
 * `GET /api/admin/reviews/summary` — per-brand moderation counters for
 * the feedback dashboard (Rust `AdminReviewBrandSummaryListResponse`).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:reviews:moderate");
    const rows = await rawAll<{
      brand_id: string | null;
      brand_name: string | null;
      brand_slug: string | null;
      brand_logo: string | null;
      total: number;
      pending: number;
      approved: number;
      rejected: number;
      hidden: number;
      avg_rating: number | null;
    }>(sql`
      SELECT r.brand_id, b.name AS brand_name, b.slug AS brand_slug, b.logo_url AS brand_logo,
             COUNT(*) AS total,
             SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN r.status = 'published' THEN 1 ELSE 0 END) AS approved,
             SUM(CASE WHEN r.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
             SUM(CASE WHEN r.status = 'hidden' THEN 1 ELSE 0 END) AS hidden,
             AVG(CASE WHEN r.status = 'published' THEN r.rating END) AS avg_rating
      FROM review r
      LEFT JOIN brand b ON b.id = r.brand_id
      GROUP BY r.brand_id, b.name, b.slug, b.logo_url
      ORDER BY total DESC
    `);
    return Response.json({
      items: rows.map((s) => ({
        brandId: s.brand_id,
        brandName: s.brand_name,
        brandSlug: s.brand_slug,
        brandLogo: s.brand_logo,
        total: Number(s.total),
        pending: Number(s.pending),
        approved: Number(s.approved),
        rejected: Number(s.rejected),
        hidden: Number(s.hidden),
        avgRating: s.avg_rating != null ? Number(s.avg_rating) : null,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
