import { handleRouteError } from "@/lib/api";
import { cacheFirst } from "@/lib/db/cache";
import { approvedReviewTags } from "@/lib/services/reviews";

/** Live data (bindings, D1): never prerendered at build. */
export const dynamic = "force-dynamic";

/** `GET /api/reviews/tags` — every tag on an approved review. */
export async function GET() {
  try {
    const items = await cacheFirst("lookups:review-tags:all", approvedReviewTags, {
      ttlMs: 120_000,
    });
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}
