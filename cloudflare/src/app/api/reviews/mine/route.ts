import { getDb } from "@/lib/db/client";
import { reviews } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { handleRouteError, requireUser } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const db = await getDb();
    const rows = await db
      .select()
      .from(reviews)
      .where(eq(reviews.userId, user.id))
      .orderBy(desc(reviews.createdAt))
      .limit(50);
    return Response.json({
      items: rows.map((r) => ({
        id: r.id,
        bookingId: r.bookingId,
        tripSessionId: r.tripSessionId,
        routeId: r.routeId,
        brandId: r.brandId,
        userId: r.userId,
        authorName: r.authorName,
        rating: r.rating,
        title: r.title,
        content: r.content,
        tags: r.tags ? JSON.parse(r.tags) : [],
        photos: r.photos ? JSON.parse(r.photos) : [],
        status: r.status,
        helpfulCount: r.helpfulCount,
        reply: r.reply,
        repliedAt: r.repliedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
