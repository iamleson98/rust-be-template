import { getDb } from "@/lib/db/client";
import { and, eq, inArray } from "drizzle-orm";
import { notifications } from "@/lib/db/schema";
import { handleRouteError, readJson, requireUser } from "@/lib/api";

const MAX_IDS = 500;
const ID_CHUNK = 80;

/** `POST /api/notifications/read` — mark all (or the given ids) read. */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await readJson<{ ids?: string[] }>(req).catch(() => ({ ids: undefined }));
    const db = await getDb();
    const unread = and(eq(notifications.userId, user.id), eq(notifications.read, false));
    let updated = 0;
    if (body.ids?.length) {
      // D1 caps bound parameters at 100 per statement: mark in chunks.
      const ids = body.ids.slice(0, MAX_IDS);
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const rows = await db
          .update(notifications)
          .set({ read: true })
          .where(and(unread, inArray(notifications.id, ids.slice(i, i + ID_CHUNK))))
          .returning({ id: notifications.id });
        updated += rows.length;
      }
    } else {
      const rows = await db
        .update(notifications)
        .set({ read: true })
        .where(unread)
        .returning({ id: notifications.id });
      updated = rows.length;
    }
    return Response.json({ ok: true, updated });
  } catch (e) {
    return handleRouteError(e);
  }
}
