import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, err } from "@/lib/api";

/** `GET /api/users/{id}` — one user (`users:read`). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff(_req);
    const { id } = await ctx.params;
    const db = await getDb();
    const row = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!row) return err(404, "not-found", "User not found");
    return Response.json({
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      role: row.role,
      status: row.status,
      isBot: !!row.isBot,
      createdAt: row.createdAt,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/users/{id}` — remove a user (`users:delete`). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    const { id } = await ctx.params;
    if (id === staff.id) return err(400, "validation", "You cannot delete yourself");
    const db = await getDb();
    const row = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!row) return err(404, "not-found", "User not found");
    if (row.role === "admin") {
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
      if (admins.length <= 1) return err(409, "conflict", "Cannot delete the last admin");
    }
    await db.delete(users).where(eq(users.id, id));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
