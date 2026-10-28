import { clientIp, handleRouteError, readJson } from "@/lib/api";
import { parseRegister, registerUser } from "@/lib/auth/auth-service";
import { authResponse, issueSession, sessionKindOf } from "@/lib/auth/session";

/**
 * `POST /api/auth/register` — create the account and sign it in at once, so
 * the client does not need a separate `/login` (Rust `routes/auth.rs::register`).
 */
export async function POST(req: Request) {
  try {
    const user = await registerUser(parseRegister(await readJson<unknown>(req)));
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
