import { getDb } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, err, readJson } from "@/lib/api";

/** `GET /api/posts/{id}` — one announcement. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = await getDb();
    const row = (await db.select().from(posts).where(eq(posts.id, id)).limit(1))[0];
    if (!row) return err(404, "not-found", "Post not found");
    return Response.json({
      id: row.id,
      authorId: row.authorId,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `PUT /api/posts/{id}` — staff edit. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff(req);
    const { id } = await ctx.params;
    const body = await readJson<{ title?: string; body?: string }>(req);
    const db = await getDb();
    await db
      .update(posts)
      .set({
        title: (body.title ?? "").trim() || undefined,
        body: (body.body ?? "").trim() || undefined,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(posts.id, id));
    const row = (await db.select().from(posts).where(eq(posts.id, id)).limit(1))[0];
    if (!row) return err(404, "not-found", "Post not found");
    return Response.json({
      id: row.id,
      authorId: row.authorId,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/posts/{id}` — staff remove. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff(req);
    const { id } = await ctx.params;
    const db = await getDb();
    await db.delete(posts).where(eq(posts.id, id));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
