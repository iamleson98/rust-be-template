import { clientIp, handleRouteError, readJson, requireUser } from "@/lib/api";
import { changePassword, parsePasswordChange } from "@/lib/auth/auth-service";
import { authResponse, issueSession, sessionKindOf } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";

/**
 * `POST /api/auth/password` — change the signed-in user's password. Every other
 * device is signed out; this one gets a fresh session (Rust `change_password`).
 */
export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    await rateLimit("AUTH", "password", caller.id);
    const user = await changePassword(caller.id, parsePasswordChange(await readJson<unknown>(req)));
    const session = await issueSession(user.id, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
      kind: sessionKindOf(req),
    });
    return await authResponse(req, user, session);
  } catch (e) {
    return handleRouteError(e);
  }
}
