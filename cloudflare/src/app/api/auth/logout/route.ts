import { handleRouteError } from "@/lib/api";
import { REFRESH_COOKIE } from "@/lib/auth/jwt";
import {
  accessTokenOf,
  clearSessionCookies,
  currentUser,
  logoutSession,
  readCookie,
} from "@/lib/auth/session";

/**
 * `POST /api/auth/logout` — revoke THIS device's session (default) or every
 * session of the user (`{"all": true}`), then clear the cookies. One user may be
 * signed in on several devices at once; signing out of one must not end the
 * others. Always 204: a failing revocation must not keep a browser signed in.
 */
export async function POST(req: Request) {
  try {
    // The body is optional (browsers POST with no payload), so parse it leniently.
    const body = (await req.json().catch(() => ({}))) as {
      refresh_token?: unknown;
      all?: unknown;
    } | null;
    const fromBody = typeof body?.refresh_token === "string" ? body.refresh_token : null;
    try {
      await logoutSession({
        userId: (await currentUser(req))?.id ?? null,
        // Mobile has no cookie jar and sends the token it holds; browsers use the cookie.
        refreshToken: fromBody ?? readCookie(req, REFRESH_COOKIE),
        accessToken: accessTokenOf(req),
        all: body?.all === true,
      });
    } catch (e) {
      console.warn("[auth] logout token revocation failed; clearing cookies anyway", e);
    }
    const headers = new Headers();
    for (const c of await clearSessionCookies(req)) headers.append("set-cookie", c);
    return new Response(null, { status: 204, headers });
  } catch (e) {
    return handleRouteError(e);
  }
}
