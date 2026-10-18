import { getDb } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { handleRouteError, requireUser } from "@/lib/api";

/** `GET /api/notifications` — the user's notifications, newest first. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 1),
      100,
    );
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const db = await getDb();
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);
    const unread = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)));
    return Response.json({
      items: rows.map((n) => ({
        id: n.id,
        userId: n.userId,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        read: n.read,
        createdAt: n.createdAt,
      })),
      limit,
      offset,
      total: rows.length + offset,
      unreadCount: unread.length,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
