import { clientIp, handleRouteError } from "@/lib/api";
import { REFRESH_COOKIE } from "@/lib/auth/jwt";
import { ApiError } from "@/lib/auth/rbac";
import { authResponse, readCookie, refreshSession, sessionKindOf } from "@/lib/auth/session";
import { Issues } from "@/lib/auth/validation";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * `POST /api/auth/refresh` — rotate the refresh token and issue a new access
 * token. The httpOnly cookie wins; the body's `refresh_token` (≤ 4096 chars) is
 * the fallback for clients without a cookie jar — the mobile app. The camelCase
 * spelling is kept for anything already sending it, and a missing body is fine.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      refresh_token?: unknown;
      refreshToken?: unknown;
    } | null;
    const fromBody = body?.refresh_token ?? body?.refreshToken;
    if (fromBody !== undefined && fromBody !== null) {
      const issues = new Issues();
      if (typeof fromBody !== "string") issues.add("refresh token", "invalid");
      else issues.length("refresh token", fromBody, 0, 4096);
      issues.throwIfAny();
    }
    const presented = readCookie(req, REFRESH_COOKIE) ?? (fromBody as string | null | undefined);
    if (!presented) throw new ApiError(401, "unauthorized", "missing refresh token");

    const session = await refreshSession(presented, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
      kind: sessionKindOf(req),
    });
    const db = await getDb();
    const user = (await db.select().from(users).where(eq(users.id, session.userId)).limit(1))[0];
    if (!user) throw new ApiError(404, "store_error", `entity not found: user ${session.userId}`);
    if (user.status !== "active") {
      throw new ApiError(403, "forbidden", user.blockReason ?? "account is not active");
    }
    return await authResponse(req, user, session);
  } catch (e) {
    return handleRouteError(e);
  }
}
