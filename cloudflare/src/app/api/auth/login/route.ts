import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import { issueSession, sessionCookies, sessionUserOut } from "@/lib/auth/session";
import { handleRouteError, readJson, clientIp, err } from "@/lib/api";
import { accessTtlSecs as accessTtl } from "@/lib/auth/jwt";
import { eq, or } from "drizzle-orm";
import { assertNotLocked, recordFailedLogin } from "@/lib/auth/lockout";
import { rateLimit } from "@/lib/rate-limit";

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

    // Brake per account being tried — before any DB or hashing work, so a
    // flood against one login (existing or not) is cheap to refuse.
    await rateLimit("AUTH", "login", email || phone);

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

    assertNotLocked(user);
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      await recordFailedLogin(user.id);
      return err(401, "invalid-credentials", "Invalid credentials");
    }

    // Imported Argon2id (or weaker-PBKDF2) hashes upgrade to the current
    // format now that the plaintext is in hand.
    const upgraded = needsRehash(user.passwordHash)
      ? { passwordHash: await hashPassword(password) }
      : {};
    await db
      .update(users)
      .set({
        ...upgraded,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date().toISOString(),
        lastLoginIp: clientIp(req),
      })
      .where(eq(users.id, user.id));

    const tokens = await issueSession(user.id, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
    });
    const headers = new Headers();
    for (const c of await sessionCookies(tokens.accessToken, tokens.refreshToken, req)) {
      headers.append("set-cookie", c);
    }
    const mobile = req.headers.get("x-client") === "mobile";
    return Response.json(
      {
        user: sessionUserOut(user),
        expires_at: new Date(Date.now() + (await accessTtl()) * 1000).toISOString(),
        ...(mobile
          ? { tokens: { access_token: tokens.accessToken, refresh_token: tokens.refreshToken } }
          : {}),
      },
      { headers },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
