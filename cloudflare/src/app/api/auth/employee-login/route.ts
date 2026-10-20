import { getDb } from "@/lib/db/client";
import { users, userRoles, roles } from "@/lib/db/schema";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import { issueSession, sessionCookies, sessionUserOut } from "@/lib/auth/session";
import { handleRouteError, readJson, clientIp, err } from "@/lib/api";
import { accessTtlSecs } from "@/lib/auth/jwt";
import { eq } from "drizzle-orm";

/**
 * `POST /api/auth/employee-login` — employee-only login (rejects regular
 * users with 403, Rust parity).
 */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(req);
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || !password) return err(400, "validation", "email and password are required");

    const db = await getDb();
    const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (!user || !user.passwordHash) return err(401, "invalid-credentials", "Invalid credentials");
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return err(401, "invalid-credentials", "Invalid credentials");

    // Only employees (or admins) pass.
    if (user.role !== "employee" && user.role !== "admin") {
      // Also accept a user holding a non-"user" role row (role tables).
      const rows = await db
        .select({ name: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, user.id));
      const staff = rows.some((r) => r.name !== "user");
      if (!staff) return err(403, "forbidden", "Not an employee");
    }

    const upgraded = needsRehash(user.passwordHash)
      ? { passwordHash: await hashPassword(password) }
      : {};
    await db
      .update(users)
      .set({ ...upgraded, lastLoginAt: new Date().toISOString(), lastLoginIp: clientIp(req) })
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
        expires_at: new Date(Date.now() + (await accessTtlSecs()) * 1000).toISOString(),
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
