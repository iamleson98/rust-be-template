import { getDb } from "@/lib/db/client";
import { users, userRoles, roles } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { issueSession, sessionCookies, sessionUserOut } from "@/lib/auth/session";
import { handleRouteError, readJson, clientIp, err } from "@/lib/api";
import { eq, sql } from "drizzle-orm";
import { normalizePhone } from "@/lib/format";

interface RegisterBody {
  fullName?: string;
  email?: string;
  phone?: string;
  password?: string;
  locale?: string;
}

export async function POST(req: Request) {
  try {
    const body = await readJson<RegisterBody>(req);
    const fullName = (body.fullName ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const phone = body.phone ? normalizePhone(body.phone) : null;
    const password = body.password ?? "";

    if (fullName.length < 2) return err(400, "validation", "fullName must be at least 2 chars");
    if (!email && !phone) return err(400, "validation", "email or phone is required");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return err(400, "validation", "invalid email");
    if (password.length < 8) return err(400, "validation", "password must be at least 8 chars");

    const db = await getDb();

    if (email) {
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) return err(409, "conflict", "email already registered");
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    // First registered user becomes admin (mirrors the Rust runtime promotion).
    const countRows = await db.select({ n: sql<number>`count(*) as n` }).from(users);
    const isFirst = Number(countRows[0]?.n ?? 0) === 0;

    await db.insert(users).values({
      id,
      fullName,
      email,
      phone,
      passwordHash,
      role: isFirst ? "admin" : "user",
      status: "active",
      locale: body.locale === "en" ? "en" : "vi",
    });

    // Grant the matching RBAC role row.
    const roleName = isFirst ? "admin" : "user";
    const roleRow = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, roleName)).limit(1);
    if (roleRow[0]) {
      await db.insert(userRoles).values({ userId: id, roleId: roleRow[0].id }).onConflictDoNothing();
    }

    const tokens = await issueSession(id, {
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
        user: sessionUserOut({ id, fullName, email, phone, role: roleName }),
        expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
        ...(mobile ? { tokens: { access_token: tokens.accessToken, refresh_token: tokens.refreshToken } } : {}),
      },
      { headers },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
