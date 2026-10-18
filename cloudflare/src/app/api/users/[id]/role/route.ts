import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, readJson, err } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";

/** `PATCH /api/users/{id}/role` — admin manages roles (last-admin guard). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { requireUser } = await import("@/lib/api");
    const caller = await requireUser(req);
    if (!isAdmin(caller)) return err(403, "forbidden", "Admin access required");
    const { id } = await ctx.params;
    const body = await readJson<{ role?: string }>(req);
    const role = body.role ?? "";
    if (!["user", "employee", "admin"].includes(role))
      return err(400, "validation", "role must be one of: user, employee, admin");

    const db = await getDb();
    const row = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!row) return err(404, "not-found", "User not found");
    if (row.isBot) return err(400, "validation", "Bot accounts cannot change roles");
    if (row.role === "admin" && role !== "admin") {
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
      if (admins.length <= 1) return err(409, "conflict", "Cannot demote the last admin");
    }
    await db
      .update(users)
      .set({ role, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id));

    // Rewrite the RBAC grants: remove every role grant, then add the new
    // role (same semantics as the Rust role-management rewrite).
    const { userRoles, roles: roleTable } = await import("@/lib/db/schema");
    await db.delete(userRoles).where(eq(userRoles.userId, id));
    const roleRow = (
      await db.select({ id: roleTable.id }).from(roleTable).where(eq(roleTable.name, role)).limit(1)
    )[0];
    if (roleRow) {
      await db.insert(userRoles).values({ userId: id, roleId: roleRow.id }).onConflictDoNothing();
    }
    const updated = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    return Response.json({
      user: {
        id: updated.id,
        fullName: updated.fullName,
        email: updated.email,
        role: updated.role,
        status: updated.status,
        isBot: !!updated.isBot,
        createdAt: updated.createdAt,
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
