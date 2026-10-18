import { rotateRefresh, sessionCookies, type IssuedTokens } from "@/lib/auth/session";
import { handleRouteError, err, clientIp } from "@/lib/api";

/** Refresh cookie first, body fallback (mobile raw-token clients). */
export async function POST(req: Request) {
  try {
    const cookie = req.headers.get("cookie") ?? "";
    const m = /(?:^|;\s*)refresh_token=([^;]+)/.exec(cookie);
    let presented = m ? decodeURIComponent(m[1]!) : null;
    if (!presented) {
      const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
      presented = body.refreshToken ?? null;
    }
    if (!presented) return err(401, "unauthorized", "refresh_token required");

    const tokens: IssuedTokens | null = await rotateRefresh(presented, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
    });
    if (!tokens) return err(401, "unauthorized", "invalid or expired refresh token");

    const secure = new URL(req.url).protocol === "https:";
    const headers = new Headers();
    for (const c of sessionCookies(tokens.accessToken, tokens.refreshToken, { secure })) {
      headers.append("set-cookie", c);
    }
    return Response.json({ ok: true }, { headers });
  } catch (e) {
    return handleRouteError(e);
  }
}
