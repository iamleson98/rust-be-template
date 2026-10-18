import { getDb } from "@/lib/db/client";
import { payments } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { handleRouteError, currentUser, err } from "@/lib/api";

export async function GET(req: Request, ctx: { params: Promise<{ bookingId: string }> }) {
  try {
    const { bookingId } = await ctx.params;
    const user = await currentUser(req);
    const db = await getDb();
    const rows = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(desc(payments.createdAt))
      .limit(10);
    if (rows.length === 0) return Response.json({ items: [] });
    if (rows[0]?.userId) {
      if (!user) return err(401, "unauthorized", "Login required");
      if (rows[0].userId !== user.id && user.role === "user")
        return err(403, "forbidden", "Not your payment");
    }
    return Response.json({
      items: rows.map((p) => ({
        id: p.id,
        provider: p.provider,
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        gatewayUrl: p.gatewayUrl,
        qrPayload: p.qrPayload,
        createdAt: p.createdAt,
        collectedAt: p.collectedAt,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
