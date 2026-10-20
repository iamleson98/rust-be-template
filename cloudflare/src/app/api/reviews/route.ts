import { limitWrite } from "@/lib/rate-limit";
import { getDb } from "@/lib/db/client";
import { reviews } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { handleRouteError, requireUser, readJson, err } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const brandId = url.searchParams.get("brand_id");
    const routeId = url.searchParams.get("route_id");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 100);
    const db = await getDb();
    const conds = [eq(reviews.status, "approved")];
    if (brandId) conds.push(eq(reviews.brandId, brandId));
    if (routeId) conds.push(eq(reviews.routeId, routeId));
    const rows = await db
      .select()
      .from(reviews)
      .where(and(...conds))
      .orderBy(desc(reviews.createdAt))
      .limit(limit);
    return Response.json({ items: rows.map(reviewOut) });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** The SPA SDK `ReviewOut` contract (tags/photos as arrays). */
function reviewOut(r: typeof reviews.$inferSelect) {
  const arr = (v: string | null) => {
    if (!v) return [];
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };
  return {
    id: r.id,
    bookingId: r.bookingId,
    tripSessionId: r.tripSessionId,
    routeId: r.routeId,
    brandId: r.brandId,
    userId: r.userId,
    authorName: r.authorName,
    authorPhone: r.authorPhone,
    rating: r.rating,
    title: r.title,
    content: r.content,
    tags: arr(r.tags),
    photos: arr(r.photos),
    status: r.status,
    helpfulCount: r.helpfulCount,
    reply: r.reply,
    repliedAt: r.repliedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await limitWrite("review", user.id);
    const body = await readJson<{
      bookingId?: string | null;
      tripSessionId?: string | null;
      routeId?: string | null;
      brandId?: string | null;
      rating?: number;
      title?: string | null;
      content?: string | null;
      tags?: string[] | null;
      photos?: string[] | null;
      authorName?: string | null;
      authorPhone?: string | null;
    }>(req);
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return err(400, "validation", "rating must be 1..5");
    if (!body.content?.trim()) return err(400, "validation", "content required");
    const db = await getDb();
    const id = crypto.randomUUID();
    const tripSessionId = body.tripSessionId ?? null;
    const authorPhone = body.authorPhone?.slice(0, 32) ?? user.phone;
    const photos = body.photos ? JSON.stringify(body.photos.slice(0, 6)) : null;
    await db.insert(reviews).values({
      id,
      bookingId: body.bookingId ?? null,
      tripSessionId,
      routeId: body.routeId ?? null,
      brandId: body.brandId ?? null,
      userId: user.id,
      authorName: body.authorName ?? user.fullName,
      authorPhone,
      rating,
      title: body.title?.slice(0, 255) ?? null,
      content: body.content.slice(0, 4000),
      tags: body.tags ? JSON.stringify(body.tags.slice(0, 10)) : null,
      photos,
      status: "pending",
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
