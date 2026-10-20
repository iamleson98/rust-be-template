import { getEnv } from "@/lib/db/client";
import { handleRouteError, requireUser } from "@/lib/api";
import { deleteDeviceForUser } from "@/lib/push/devices";

/** `DELETE /api/push/devices/{token}` — unregister on logout (owner only). */
export async function DELETE(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const user = await requireUser(req);
    const { token } = await ctx.params;
    const env = await getEnv();
    const deleted = await deleteDeviceForUser(env.DB, user.id, decodeURIComponent(token));
    return Response.json({ ok: true, deleted });
  } catch (e) {
    return handleRouteError(e);
  }
}
