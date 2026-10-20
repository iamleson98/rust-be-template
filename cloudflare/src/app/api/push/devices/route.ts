import { getEnv } from "@/lib/db/client";
import { handleRouteError, readJson, requireUser, err } from "@/lib/api";
import { normalizePlatform, upsertDevice } from "@/lib/push/devices";
import { pushEnabled } from "@/lib/push/notify";

/**
 * `POST /api/push/devices` — register the caller's FCM / APNs-VoIP token so
 * the server can wake the app for incoming calls. Idempotent; any signed-in
 * user may register, but call rings only ever target staff.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await readJson<{ token?: string; platform?: string }>(req);
    const token = (body.token ?? "").trim();
    if (!token) return err(400, "validation", "token cannot be empty");
    if (token.length > 4096) return err(400, "validation", "token too long");
    const env = await getEnv();
    await upsertDevice(env.DB, user.id, token, normalizePlatform(body.platform));
    return Response.json({ ok: true, pushEnabled: pushEnabled(env) });
  } catch (e) {
    return handleRouteError(e);
  }
}
