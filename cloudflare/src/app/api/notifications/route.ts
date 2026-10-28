import { handleRouteError, requireUser } from "@/lib/api";
import { optionalCount } from "@/lib/services/pagination";
import { listNotifications } from "@/lib/services/notifications";

/** `GET /api/notifications` — the caller's notifications, newest first (default 20, max 200). */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const q = new URL(req.url).searchParams;
    return Response.json(
      await listNotifications(
        user.id,
        optionalCount(q, "limit") ?? 20,
        optionalCount(q, "offset") ?? 0,
      ),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
