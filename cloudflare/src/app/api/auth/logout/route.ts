import { clearSessionCookies, revokeAllSessions, revokeSession } from "@/lib/auth/session";
import { handleRouteError, readJson, currentUser } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const body = await readJson<{ all?: boolean }>(req).catch(() => ({ all: false }));
    const cookie = req.headers.get("cookie") ?? "";
    const m = /(?:^|;\s*)refresh_token=([^;]+)/.exec(cookie);
    const refreshToken = m ? decodeURIComponent(m[1]!) : null;

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
