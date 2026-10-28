/** User notifications — the port of Rust `service/notification_service.rs`. */
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";

export const MAX_LIMIT = 200;

/** D1 allows 100 bound parameters per statement: one for the user, the rest for ids. */
const ID_CHUNK = 80;

/** Newest first, with the user's total and unread count (`NotificationListResponse`). */
export async function listNotifications(userId: string, requestedLimit: number, offset: number) {
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);
  const db = await getDb();
  const mine = eq(notifications.userId, userId);
  const [items, total, unread] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(mine)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(notifications).where(mine),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(mine, eq(notifications.read, false))),
  ]);
  return {
    items: items.map((n) => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data,
      read: n.read,
      createdAt: n.createdAt,
    })),
    total: total[0]?.n ?? 0,
    unreadCount: unread[0]?.n ?? 0,
    limit,
    offset,
  };
}

/**
 * Mark the given notifications read, or all of the user's unread ones when no
 * ids are given. Ids that are not the caller's are ignored (no IDOR). Returns
 * the number of rows actually changed.
 */
export async function markNotificationsRead(userId: string, ids: string[]): Promise<number> {
  const db = await getDb();
  const unread = and(eq(notifications.userId, userId), eq(notifications.read, false));
  if (ids.length === 0) {
    const rows = await db
      .update(notifications)
      .set({ read: true })
      .where(unread)
      .returning({ id: notifications.id });
    return rows.length;
  }
  let updated = 0;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const rows = await db
      .update(notifications)
      .set({ read: true })
      .where(and(unread, inArray(notifications.id, ids.slice(i, i + ID_CHUNK))))
      .returning({ id: notifications.id });
    updated += rows.length;
  }
  return updated;
}
