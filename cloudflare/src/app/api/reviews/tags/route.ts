import { handleRouteError } from "@/lib/api";
import { reviewTags } from "@/lib/services/lookups";

/** `GET /api/reviews/tags` — the tags that appear on approved reviews. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "12", 10) || 12, 50);
    return Response.json({ items: await reviewTags(limit) });
  } catch (e) {
    return handleRouteError(e);
  }
}
