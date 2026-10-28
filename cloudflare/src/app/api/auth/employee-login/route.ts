import { clientIp, handleRouteError, readJson } from "@/lib/api";
import { authenticate, parseLogin } from "@/lib/auth/auth-service";
import { ApiError, isEmployeeAccount } from "@/lib/auth/rbac";
import { authResponse, issueSession, sessionKindOf } from "@/lib/auth/session";

/**
 * `POST /api/auth/employee-login` — login for staff only. The credentials are
 * checked first (401), then a plain customer is refused with 403.
 */
export async function POST(req: Request) {
  try {
    const user = await authenticate(req, parseLogin(await readJson<unknown>(req)));
    if (!(await isEmployeeAccount(user.id))) {
      throw new ApiError(403, "forbidden", "This endpoint is for employees only");
    }
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
