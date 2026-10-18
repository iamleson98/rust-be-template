import { rawAll, rawRun } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireUser, readJson, err } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

function reviewOut(r: Record<string, unknown>) {
  return {
    id: r.id,
    userId: r.user_id,
    authorName: r.author_name,
    authorPhone: r.author_phone,
    bookingId: r.booking_id,
    tripSessionId: r.trip_session_id,
    brandId: r.brand_id,
    routeId: r.route_id,
    rating: r.rating,
    title: r.title,
    content: r.content,
    tags: JSON.parse((r.tags as string) ?? "[]"),
    photos: JSON.parse((r.photos as string) ?? "[]"),
    status: r.status,
    reply: r.reply,
    repliedAt: r.replied_at,
    helpfulCount: r.helpful_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** `GET /api/reviews/{id}` — one review. */
export async function GET(_req: Request, ctx: Params) {
  try {
    const { id } = await ctx.params;
    const rows = await rawAll<Record<string, unknown>>(sql`
      SELECT * FROM review WHERE id = ${id} LIMIT 1
    `);
    if (!rows[0]) return err(404, "not-found", "review not found");
    return Response.json(reviewOut(rows[0]));
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
    const rows = await rawAll<Record<string, unknown>>(sql`
      SELECT * FROM review WHERE id = ${id} LIMIT 1
    `);
    const existing = rows[0];
    if (!existing) return err(404, "not-found", "review not found");
    const isAuthor = existing.user_id === user.id;
    const isStaff = user.role === "admin" || user.role === "employee";
    if (!isAuthor && !isStaff) return err(403, "forbidden", "Not your review");
    if (existing.status === "published" && !isStaff) {
      return err(409, "conflict", "Published reviews can no longer be edited");
    }
    const rating = body.rating ?? Number(existing.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return err(400, "validation", "rating must be 1..5");
    }
    const now = new Date().toISOString();
    await rawRun(sql`
      UPDATE review SET
        rating = ${rating},
        title = ${body.title ?? (existing.title as string | null)},
        content = ${body.content ?? (existing.content as string | null)},
        tags = ${body.tags ? JSON.stringify(body.tags.slice(0, 10)) : (existing.tags as string | null)},
        photos = ${body.photos ? JSON.stringify(body.photos.slice(0, 6)) : (existing.photos as string | null)},
        status = 'pending', updated_at = ${now}
      WHERE id = ${id}
    `);
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
    const rows = await rawAll<{ id: string; user_id: string; status: string }>(sql`
      SELECT id, user_id, status FROM review WHERE id = ${id} LIMIT 1
    `);
    const existing = rows[0];
    if (!existing) return err(404, "not-found", "review not found");
    const isAuthor = existing.user_id === user.id;
    const isStaff = user.role === "admin";
    if (!isAuthor && !isStaff) return err(403, "forbidden", "Not your review");
    await rawRun(sql`DELETE FROM review WHERE id = ${id}`);
    return Response.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
