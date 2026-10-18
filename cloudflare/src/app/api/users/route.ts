import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";

/** `GET /api/users` — paginated user list (`users:read` staff only). */
export async function GET(req: Request) {
  try {
    await requireStaff(req);
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const db = await getDb();
    const rows = await db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
    return Response.json({ items: rows.map(userOut), total: rows.length + offset });
  } catch (e) {
    return handleRouteError(e);
  }
}

export function userOut(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    status: u.status,
    isBot: !!u.isBot,
    createdAt: u.createdAt,
  };
}
