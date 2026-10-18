import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { handleRouteError, readJson, requireUser, err } from "@/lib/api";
import { eq } from "drizzle-orm";

/** `POST /api/auth/password` — change the signed-in account's password. */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await readJson<{ currentPassword?: string | null; newPassword?: string }>(req);
    const newPassword = body.newPassword ?? "";
    if (newPassword.length < 8)
      return err(400, "validation", "newPassword must be at least 8 characters");

    const db = await getDb();
    const current = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
    if (!current) return err(404, "not-found", "User not found");

    // Accounts with an existing password must confirm the current one.
    if (current.passwordHash) {
      const { verifyPassword } = await import("@/lib/auth/password");
      const given = body.currentPassword ?? "";
      const ok = given !== "" && (await verifyPassword(given, current.passwordHash));
      if (!ok) return err(400, "invalid-credentials", "currentPassword is incorrect");
    }

    const passwordHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ passwordHash, passwordChangedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(users.id, user.id));
    // Rust returns the fresh session envelope after a password change.
    const row = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0]!;
    const { sessionUserOut } = await import("@/lib/auth/session");
    return Response.json({
      user: sessionUserOut(row),
      expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
