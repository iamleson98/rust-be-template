import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { reviews } from "@/lib/db/schema";
import { handleRouteError, requireUser, readJson, err } from "@/lib/api";
import { isAdmin, isStaff } from "@/lib/auth/rbac";

type Params = { params: Promise<{ id: string }> };

type ReviewRow = typeof reviews.$inferSelect;

function reviewOut(r: ReviewRow) {
  return {
    id: r.id,
    userId: r.userId,
    authorName: r.authorName,
    authorPhone: r.authorPhone,
    bookingId: r.bookingId,
    tripSessionId: r.tripSessionId,
    brandId: r.brandId,
    routeId: r.routeId,
    rating: r.rating,
    title: r.title,
    content: r.content,
    tags: JSON.parse(r.tags ?? "[]"),
    photos: JSON.parse(r.photos ?? "[]"),
    status: r.status,
    reply: r.reply,
    repliedAt: r.repliedAt,
    helpfulCount: r.helpfulCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function findReview(id: string): Promise<ReviewRow | undefined> {
  const db = await getDb();
  return (await db.select().from(reviews).where(eq(reviews.id, id)).limit(1))[0];
}

/** `GET /api/reviews/{id}` — one review. */
export async function GET(_req: Request, ctx: Params) {
  try {
    const { id } = await ctx.params;
    const existing = await findReview(id);
    if (!existing) return err(404, "not-found", "review not found");
    return Response.json(reviewOut(existing));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `PATCH /api/reviews/{id}` — the author edits their review (pending again). */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const body = await readJson<{
      rating?: number | null;
      title?: string | null;
      content?: string | null;
      tags?: string[] | null;
      photos?: string[] | null;
    }>(req);
    const existing = await findReview(id);
    if (!existing) return err(404, "not-found", "review not found");
    const isAuthor = existing.userId === user.id;
    const staff = isStaff(user);
    if (!isAuthor && !staff) return err(403, "forbidden", "Not your review");
    if (existing.status === "published" && !staff) {
      return err(409, "conflict", "Published reviews can no longer be edited");
    }
    const rating = body.rating ?? Number(existing.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return err(400, "validation", "rating must be 1..5");
    }
    const db = await getDb();
    await db
      .update(reviews)
      .set({
        rating,
        title: body.title ?? existing.title,
        content: body.content ?? existing.content,
        tags: body.tags ? JSON.stringify(body.tags.slice(0, 10)) : existing.tags,
        photos: body.photos ? JSON.stringify(body.photos.slice(0, 6)) : existing.photos,
        status: "pending",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(reviews.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/reviews/{id}` — the author withdraws their review. */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const existing = await findReview(id);
    if (!existing) return err(404, "not-found", "review not found");
    const isAuthor = existing.userId === user.id;
    if (!isAuthor && !isAdmin(user)) return err(403, "forbidden", "Not your review");
    const db = await getDb();
    await db.delete(reviews).where(eq(reviews.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
