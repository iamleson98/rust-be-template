import { handleRouteError, readOptionalJson, requireUser } from "@/lib/api";
import { ApiError } from "@/lib/auth/rbac";
import { isUuid } from "@/lib/auth/jwt";
import { markNotificationsRead } from "@/lib/services/notifications";

/** Most ids one request may name (each is a bound D1 parameter, in chunks). */
const MAX_IDS = 500;

/**
 * `POST /api/notifications/read` — mark the given ids read, or every unread
 * notification when `ids` is empty or missing. Answers `{ ok, updated }`.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const ids = (await readOptionalJson<{ ids: unknown }>(req)).ids ?? [];
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && isUuid(id))) {
      throw new ApiError(400, "bad_request", "ids must be an array of UUIDs");
    }
    if (ids.length > MAX_IDS) {
      throw new ApiError(400, "bad_request", `at most ${MAX_IDS} ids per request`);
    }
    return Response.json({ ok: true, updated: await markNotificationsRead(user.id, ids) });
  } catch (e) {
    return handleRouteError(e);
  }
}
