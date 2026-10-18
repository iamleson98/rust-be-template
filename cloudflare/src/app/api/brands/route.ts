import { getDb } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, err } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 1), 200);
    const db = await getDb();
    const rows = await db
      .select()
      .from(brands)
      .where(eq(brands.status, "active"))
      .limit(limit);
    return Response.json({
      items: rows.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        logoUrl: b.logoUrl,
        description: b.description,
        contactPhone: b.contactPhone,
        contactEmail: b.contactEmail,
        rating: b.rating,
        totalTrips: b.totalTrips,
        childMaxAge: b.childMaxAge,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
