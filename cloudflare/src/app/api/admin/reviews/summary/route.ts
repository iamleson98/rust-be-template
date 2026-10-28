import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { brandReviewSummary } from "@/lib/services/reviews";

/** `GET /api/admin/reviews/summary` — per-brand moderation counters for the feedback page. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:reviews:moderate");
    return Response.json(await brandReviewSummary());
  } catch (e) {
    return handleRouteError(e);
  }
}
