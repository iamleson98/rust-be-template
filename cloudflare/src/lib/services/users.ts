/**
 * User administration — the port of Rust `service/users_service.rs` and the
 * `UserOut` DTO of `routes/users.rs`. Permission checks stay in the routes.
 */
import { and, count, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { staffPresenceState, users } from "@/lib/db/schema";
import { ApiError, replaceRole } from "@/lib/auth/rbac";

export type UserRow = typeof users.$inferSelect;
export const ROLE_NAMES = ["user", "employee", "admin"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** Rust `UserOut`. The email column is non-null but may be empty; the wire says `None` then. */
export function userOut(u: UserRow) {
  return {
    id: u.id,
    ...(u.email ? { email: u.email } : {}),
    fullName: u.fullName,
    createdAt: u.createdAt,
    role: u.role,
    isBot: u.isBot,
    status: u.status,
  };
}

const notFound = (id: string) => new ApiError(404, "store_error", `entity not found: user ${id}`);

/** Rust `Path<Uuid>`: anything else is rejected before the handler runs. */
export function assertUserId(id: string): void {
  if (!/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
    throw new ApiError(400, "bad_request", `invalid user id '${id}'`);
  }
}

/** One page, newest first, and the unfiltered total (the admin Users table). */
export async function listUsers(limit: number, offset: number) {
  const db = await getDb();
  const [items, totals] = await Promise.all([
    db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
    db.select({ n: count() }).from(users),
  ]);
  return { items: items.map(userOut), total: totals[0]?.n ?? 0 };
}

export async function getUser(id: string): Promise<UserRow> {
  const db = await getDb();
  const row = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!row) throw notFound(id);
  return row;
}

/** Human admins — the NullClaw bot never counts toward the last-admin guard. */
async function humanAdminCount(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isBot, false)));
  return rows[0]?.n ?? 0;
}

/**
 * Rust `UserService::set_role`. Bot accounts keep their role, and the last
 * human admin cannot be demoted. Updates the `user.role` column and the RBAC
 * grant, so permission checks flip at once.
 */
export async function setUserRole(id: string, role: RoleName): Promise<UserRow> {
  const target = await getUser(id);
  if (target.isBot) throw new ApiError(400, "validation_error", "bot accounts cannot change roles");
  if (target.role === "admin" && role !== "admin" && (await humanAdminCount()) <= 1) {
    throw new ApiError(
      409,
      "conflict",
      "cannot demote the last admin — promote another admin first",
    );
  }
  const db = await getDb();
  await db.update(users).set({ role, updatedAt: new Date().toISOString() }).where(eq(users.id, id));
  await replaceRole(id, role);
  // Staff leaving their role: routing must stop considering them at once.
  if ((target.role === "employee" || target.role === "admin") && role === "user") {
    await db.delete(staffPresenceState).where(eq(staffPresenceState.userId, id));
  }
  return getUser(id);
}

/**
 * Delete an account. Rust has no guard here; the port refuses the two deletions
 * that lock an organisation out: oneself and the last human admin.
 */
export async function deleteUser(actorId: string, id: string): Promise<void> {
  if (id === actorId) throw new ApiError(400, "bad_request", "you cannot delete yourself");
  const db = await getDb();
  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return; // Rust: deleting an unknown id succeeds
  if (target.role === "admin" && !target.isBot && (await humanAdminCount()) <= 1) {
    throw new ApiError(409, "conflict", "cannot delete the last admin");
  }
  await db.delete(users).where(and(eq(users.id, id), ne(users.id, actorId)));
}
