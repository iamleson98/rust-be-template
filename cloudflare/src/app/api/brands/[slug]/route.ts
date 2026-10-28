import { handleRouteError, err } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { getBrandBySlug } from "@/lib/services/lookups";

/** `GET /api/brands/{slug}` — an active brand's detail. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const brand = await getBrandBySlug(slug);
    return brand ? publicJson(req, brand) : err(404, "not-found", "brand not found");
  } catch (e) {
    return handleRouteError(e);
  }
}
