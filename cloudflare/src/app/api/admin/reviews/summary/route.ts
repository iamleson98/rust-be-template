import { staffRoute } from "@/lib/api";
import { brandReviewSummary } from "@/lib/services/reviews";

/** `GET /api/admin/reviews/summary` — per-brand moderation counters for the feedback page. */
export const GET = staffRoute("admin:reviews:moderate", async () => {
  return Response.json(await brandReviewSummary());
});
