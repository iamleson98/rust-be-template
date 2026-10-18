import { getDb } from "@/lib/db/client";
import { priceAlerts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireUser, err } from "@/lib/api";

/** `DELETE /api/price-alerts/{id}` — stop watching. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(_req);
    const { id } = await ctx.params;
    const db = await getDb();
    const row = (await db.select().from(priceAlerts).where(eq(priceAlerts.id, id)).limit(1))[0];
    if (!row) return err(404, "not-found", "Price alert not found");
    await db.delete(priceAlerts).where(eq(priceAlerts.id, id));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
