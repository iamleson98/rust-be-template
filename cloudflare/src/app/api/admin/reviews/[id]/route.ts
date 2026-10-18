import { rawAll, rawRun } from "@/lib/db/client";
import { invalidateReviews } from "@/lib/services/lookups";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

type Params = { params: Promise<{ id: string }> };

/**
 * `PATCH /api/admin/reviews/{id}` — moderate: publish/reject/hide and
 * optionally leave the brand's reply (Rust `ModerateReviewResponse`).
 */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:reviews:moderate");
    const { id } = await ctx.params;
    const body = await readJson<{ status?: string; brandReply?: string | null }>(req);
    const status = body.status;
    if (status && !["pending", "published", "rejected", "hidden"].includes(status)) {
      return err(400, "validation", "unsupported status");
    }
    const rows = await rawAll<{ id: string; replied_at: string | null }>(
      sql`SELECT id, replied_at FROM review WHERE id = ${id} LIMIT 1`,
    );
    if (!rows[0]) return err(404, "not-found", "review not found");

    const now = new Date().toISOString();
    await rawRun(sql`
      UPDATE review
      SET status = COALESCE(${status ?? null}, status),
          reply = ${body.brandReply ?? null},
          replied_at = CASE WHEN ${body.brandReply ?? null} IS NOT NULL THEN ${now} ELSE replied_at END,
          updated_at = ${now}
      WHERE id = ${id}
    `);
    await invalidateReviews();
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}
