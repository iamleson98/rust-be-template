import { getDb } from "@/lib/db/client";
import { brands, routes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";
import { VIETNAMESE_CITIES } from "@/lib/cities";

const cityBySlug = new Map(VIETNAMESE_CITIES.map((c) => [c.id, c]));

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const brandId = url.searchParams.get("brand_id");
    const db = await getDb();
    const rows = await db
      .select({
        id: routes.id,
        name: routes.name,
        status: routes.status,
        brandId: routes.brandId,
        brandName: brands.name,
        brandSlug: brands.slug,
        startLocationId: routes.startLocationId,
        endLocationId: routes.endLocationId,
        createdAt: routes.createdAt,
      })
      .from(routes)
      .leftJoin(brands, eq(brands.id, routes.brandId))
      .where(brandId ? eq(routes.brandId, brandId) : eq(routes.status, "active"));
    return Response.json({
      items: rows.map((r) => {
        const from = cityBySlug.get(r.startLocationId);
        const to = cityBySlug.get(r.endLocationId);
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          brand: r.brandId ? { id: r.brandId, name: r.brandName, slug: r.brandSlug } : null,
          from: { id: r.startLocationId, name: from?.name ?? r.startLocationId },
          to: { id: r.endLocationId, name: to?.name ?? r.endLocationId },
          createdAt: r.createdAt,
        };
      }),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
