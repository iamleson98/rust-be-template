import { handleRouteError, err } from "@/lib/api";
import { getBrandBySlug } from "@/lib/services/lookups";

/** `GET /api/brands/{slug}` — brand detail (`BrandDetailOut` contract). */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const row = await getBrandBySlug(slug);
    if (!row) return err(404, "not-found", "Brand not found");
    return Response.json(row);
  } catch (e) {
    return handleRouteError(e);
  }
}
