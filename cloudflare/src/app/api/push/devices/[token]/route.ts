import { getEnv } from "@/lib/db/client";
import { handleRouteError, requireUser } from "@/lib/api";
import { deleteDeviceForUser } from "@/lib/push/devices";

/** Route params arrive percent-encoded or already decoded depending on the runtime; a stray `%` must not 500. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** `DELETE /api/push/devices/{token}` — unregister on logout (owner only). */
export async function DELETE(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const user = await requireUser(req);
    const { token } = await ctx.params;
    const env = await getEnv();
    const deleted = await deleteDeviceForUser(env.DB, user.id, safeDecode(token));
    return Response.json({ ok: true, deleted });
  } catch (e) {
    return handleRouteError(e);
  }
}
