import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { issueSession, sessionCookies, sessionUserOut } from "@/lib/auth/session";
import { handleRouteError, readJson, clientIp, err } from "@/lib/api";
import { accessTtlSecs as accessTtl } from "@/lib/auth/jwt";
import { eq, or } from "drizzle-orm";

interface LoginBody {
  email?: string;
  phone?: string;
  password?: string;
}

export async function POST(req: Request) {
  try {
    const body = await readJson<LoginBody>(req);
    const email = (body.email ?? "").trim().toLowerCase();
    const phone = (body.phone ?? "").trim();
    const password = body.password ?? "";
    if (!password || (!email && !phone))
      return err(400, "validation", "email/phone and password are required");

    const db = await getDb();
    const rows = await db
      .select()
      .from(users)
      .where(
        email
          ? eq(users.email, email)
          : or(eq(users.phone, phone), eq(users.phone, `+84${phone.replace(/^0/, "")}`)),
      )
      .limit(1);
    const user = rows[0];
    if (!user || !user.passwordHash) return err(401, "invalid-credentials", "Invalid credentials");
    if (user.status !== "active")
      return err(403, "blocked", user.blockReason ?? "Account is not active");

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return err(401, "invalid-credentials", "Invalid credentials");

    await db
      .update(users)
      .set({ lastLoginAt: new Date().toISOString(), lastLoginIp: clientIp(req) })
      .where(eq(users.id, user.id));

    const tokens = await issueSession(user.id, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
    });
    const secure = new URL(req.url).protocol === "https:";
    const headers = new Headers();
    for (const c of sessionCookies(tokens.accessToken, tokens.refreshToken, { secure })) {
      headers.append("set-cookie", c);
    }
    const mobile = req.headers.get("x-client") === "mobile";
    return Response.json(
      {
        user: sessionUserOut(user),
        expires_at: new Date(Date.now() + (await accessTtl()) * 1000).toISOString(),
        ...(mobile ? { tokens: { access_token: tokens.accessToken, refresh_token: tokens.refreshToken } } : {}),
      },
      { headers },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
