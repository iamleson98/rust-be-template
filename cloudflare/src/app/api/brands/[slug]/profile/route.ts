import { handleRouteError, err } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { getBrandProfile } from "@/lib/services/brand-profile";

/**
 * `GET /api/brands/{slug}/profile` — everything a brand's page shows in one
 * read: the brand, its locations, routes with timetables and the trips
 * about to leave. Served from the colo's Cache API (`edge-guard.ts`).
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const profile = await getBrandProfile(slug);
    return profile ? publicJson(req, profile) : err(404, "not-found", "brand not found");
  } catch (e) {
    return handleRouteError(e);
  }
}
