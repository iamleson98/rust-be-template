import { rotateRefresh, sessionCookies, type IssuedTokens } from "@/lib/auth/session";
import { handleRouteError, err, clientIp } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sessionUserOut } from "@/lib/auth/session";
import { accessTtlSecs } from "@/lib/auth/jwt";

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

    const tokens: (IssuedTokens & { userId: string }) | null = await rotateRefresh(presented, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
    });
    if (!tokens) return err(401, "unauthorized", "invalid or expired refresh token");

    const headers = new Headers();
    for (const c of await sessionCookies(tokens.accessToken, tokens.refreshToken, req)) {
      headers.append("set-cookie", c);
    }
    const db = await getDb();
    const user = (await db.select().from(users).where(eq(users.id, tokens.userId)).limit(1))[0];
    if (!user) return err(401, "unauthorized", "user gone");
    const mobile = req.headers.get("x-client") === "mobile";
    return Response.json(
      {
        user: sessionUserOut(user),
        expires_at: new Date(Date.now() + (await accessTtlSecs()) * 1000).toISOString(),
        ...(mobile ? { tokens: { access_token: tokens.accessToken, refresh_token: tokens.refreshToken } } : {}),
      },
      { headers },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
