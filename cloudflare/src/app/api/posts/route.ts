import { getDb } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { handleRouteError, readJson, requireStaff, err } from "@/lib/api";

/** `GET /api/posts` — announcements (newest first). */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const db = await getDb();
    const rows = await db
      .select()
      .from(posts)
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset(offset);
    return Response.json({
      items: rows.map(postOut),
      limit,
      offset,
      total: rows.length + offset,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/posts` — staff publish an announcement. */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    const body = await readJson<{ title?: string; body?: string }>(req);
    const title = (body.title ?? "").trim();
    const content = (body.body ?? "").trim();
    if (!title || !content) return err(400, "validation", "title and body required");
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.insert(posts).values({ id, authorId: staff.id, title, body: content });
    const row = (await db.select().from(posts).where(eq(posts.id, id)).limit(1))[0];
    return Response.json(postOut(row), { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

function postOut(p: typeof posts.$inferSelect) {
  return {
    id: p.id,
    authorId: p.authorId,
    title: p.title,
    body: p.body,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
