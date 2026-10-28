import { handleRouteError, readJson } from "@/lib/api";
import { authenticate, parseLogin } from "@/lib/auth/auth-service";
import { authResponse, issueSession, sessionKindOf } from "@/lib/auth/session";
import { clientIp } from "@/lib/api";

/** `POST /api/auth/login` — exchange credentials for cookies (Rust `routes/auth.rs::login`). */
export async function POST(req: Request) {
  try {
    const user = await authenticate(req, parseLogin(await readJson<unknown>(req)));
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
