import { getDb } from "@/lib/db/client";
import { and, eq, inArray } from "drizzle-orm";
import { notifications } from "@/lib/db/schema";
import { handleRouteError, readJson, requireUser } from "@/lib/api";

/** `POST /api/notifications/read` — mark all (or the given ids) read. */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await readJson<{ ids?: string[] }>(req).catch(() => ({ ids: undefined }));
    const db = await getDb();
    const where = body.ids?.length
      ? and(eq(notifications.userId, user.id), eq(notifications.read, false), inArray(notifications.id, body.ids))
      : and(eq(notifications.userId, user.id), eq(notifications.read, false));
    const rows = await db
      .update(notifications)
      .set({ read: true })
      .where(where)
      .returning({ id: notifications.id });
    return Response.json({ ok: true, updated: rows.length });
  } catch (e) {
    return handleRouteError(e);
  }
}
