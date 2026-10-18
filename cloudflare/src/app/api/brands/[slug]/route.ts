import { getDb } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, err } from "@/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const db = await getDb();
    const row = (await db.select().from(brands).where(eq(brands.slug, slug)).limit(1))[0];
    if (!row) return err(404, "not-found", "Brand not found");
    return Response.json({
      id: row.id,
      slug: row.slug,
      name: row.name,
      logoUrl: row.logoUrl,
      description: row.description,
      contactPhone: row.contactPhone,
      contactEmail: row.contactEmail,
      rating: row.rating,
      totalTrips: row.totalTrips,
      childMaxAge: row.childMaxAge,
      childDiscountAmount: row.childDiscountAmount,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
