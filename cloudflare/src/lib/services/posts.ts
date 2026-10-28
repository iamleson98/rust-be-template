/** Posts — port of `posts_service.rs` and `routes/posts.rs`. Reads are public; writes need `posts:write` / `posts:delete`. */
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import { badRequest, notFound } from "@/lib/services/http-errors";

type PostRow = typeof posts.$inferSelect;

export const postOut = (p: PostRow) => ({
  id: p.id,
  authorId: p.authorId,
  title: p.title,
  body: p.body,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const chars = (s: string): number => [...s].length;

/** Both layers of Rust's checks: the DTO's `length` rules (chars), the service's `title.len()` (bytes). */
function checkTitle(title: unknown): asserts title is string {
  if (typeof title !== "string" || chars(title) < 1 || chars(title) > 256)
    throw badRequest("title has an invalid length");
  if (new TextEncoder().encode(title).length > 256)
    throw badRequest("title must be 1-256 characters");
}

function checkBody(body: unknown): asserts body is string {
  if (typeof body !== "string" || body.length < 1) throw badRequest("body has an invalid length");
}

/** `GET /api/posts`: the page echoes `limit` capped at 200, while the query itself stops at 100. */
export async function listPosts(limit: number, offset: number) {
  const echoed = Math.min(limit, 200);
  const db = await getDb();
  const rows = await db
    .select()
    .from(posts)
    .orderBy(desc(posts.createdAt))
    .limit(Math.min(echoed, 100))
    .offset(offset);
  return { items: rows.map(postOut), limit: echoed, offset };
}

export async function getPost(id: string) {
  const db = await getDb();
  const row = (await db.select().from(posts).where(eq(posts.id, id)).limit(1))[0];
  if (!row) throw notFound(`post ${id}`);
  return postOut(row);
}

export interface PostBody {
  title?: unknown;
  body?: unknown;
}

/** The request rules; Rust runs them before the permission check. A patch may omit either field. */
export function validatePost(b: PostBody, partial: boolean): void {
  if (typeof b !== "object" || b === null) throw badRequest("invalid request body");
  if (!partial || b.title != null) checkTitle(b.title);
  if (!partial || b.body != null) checkBody(b.body);
}

/** `validatePost` has run. */
export async function createPost(authorId: string, b: { title: string; body: string }) {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(posts).values({ id, authorId, title: b.title, body: b.body });
  return getPost(id);
}

/** `validatePost` has run. */
export async function updatePost(id: string, body: PostBody) {
  await getPost(id);
  const db = await getDb();
  await db
    .update(posts)
    .set({
      ...(body.title != null && { title: body.title as string }),
      ...(body.body != null && { body: body.body as string }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(posts.id, id));
  return getPost(id);
}

export async function deletePost(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(posts).where(eq(posts.id, id));
}
