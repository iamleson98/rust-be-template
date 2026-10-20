import { clearSessionCookies, revokeAllSessions, revokeSession } from "@/lib/auth/session";
import { handleRouteError, readJson, currentUser } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const body = await readJson<{ all?: boolean; refresh_token?: string }>(req).catch(
      () => ({}) as { all?: boolean; refresh_token?: string },
    );
    const cookie = req.headers.get("cookie") ?? "";
    const m = /(?:^|;\s*)refresh_token=([^;]+)/.exec(cookie);
    // Browsers: the httpOnly cookie. The mobile app has no cookie jar and
    // sends the token it holds in the body, so THIS device's session is the
    // one revoked (not a no-op that leaves the token valid after "logout").
    const refreshToken = m ? decodeURIComponent(m[1]) : (body.refresh_token ?? null);

    if (body.all) {
      const user = await currentUser(req);
      if (user) await revokeAllSessions(user.id);
    } else {
      await revokeSession(refreshToken);
    }

    const headers = new Headers();
    for (const c of await clearSessionCookies(req)) headers.append("set-cookie", c);
    return new Response(null, { status: 204, headers });
  } catch (e) {
    return handleRouteError(e);
  }
}
