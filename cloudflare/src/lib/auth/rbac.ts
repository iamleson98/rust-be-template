/**
 * RBAC — permission catalog + role grants, mirroring the Rust seeds
 * (m20260905_000010_seed_defaults). Roles: admin / employee / user.
 * Employee = everything except ADMIN_ONLY; user = USER_PERMS.
 */
import { and, eq, sql } from "drizzle-orm";
import { atomicBatch, getDb } from "@/lib/db/client";
import { permissions, rolePermissions, roles, userRoles, users } from "@/lib/db/schema";
import type { SessionUser } from "./session";

export const ROLES = ["admin", "employee", "user"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS: Record<string, string> = {
  "users:read": "Read user list and profiles",
  "users:write": "Create/update users",
  "users:delete": "Delete users",
  "posts:read": "Read posts",
  "posts:write": "Create/update posts",
  "posts:delete": "Delete posts",
  "admin:brands:read": "Admin: list/view brands",
  "admin:brands:write": "Admin: create/update/delete brands",
  "admin:routes:read": "Admin: list/view routes",
  "admin:routes:write": "Admin: create/update/delete routes",
  "admin:schedules:read": "Admin: list/view schedules",
  "admin:schedules:write": "Admin: create/update/delete schedules",
  "admin:addresses:read": "Admin: list brand addresses",
  "admin:addresses:write": "Admin: create/update/delete brand addresses",
  "admin:cron-jobs:read": "Admin: view scheduled jobs and run history",
  "admin:cron-jobs:write": "Admin: trigger/reschedule/enable+disable jobs",
  "admin:pickup_points:read": "Admin: list/view pickup points",
  "admin:pickup_points:write": "Admin: create/update/delete pickup points",
  "admin:bus_layouts:read": "Admin: list bus layouts",
  "admin:bus_layouts:write": "Admin: create/update/delete bus layouts",
  "admin:vehicle_types:read": "Admin: list vehicle types",
  "admin:vehicle_types:write": "Admin: create/update/delete vehicle types",
  "admin:reviews:moderate": "Admin: moderate reviews",
  "admin:bookings:read": "Admin: list/view bookings",
  "admin:bookings:write": "Admin: update booking status",
  "admin:payments:read": "Admin: list/view payments",
  "admin:payments:write": "Admin: update payment status, mark COD collected",
  "admin:stats:read": "Admin: view booking statistics",
  "admin:export": "Admin: export bookings as CSV",
  "admin:nullclaw:read": "Admin: view NullClaw AI exchange audit log",
  "admin:users:manage-roles": "Admin: grant/revoke user, employee and admin roles",
  "admin:campaigns:manage":
    "Admin: create/edit discount campaigns, review and settle coupon payouts",
};

export const ADMIN_ONLY_PERMS = [
  "admin:campaigns:manage",
  "users:write",
  "users:delete",
  "admin:users:manage-roles",
  "admin:cron-jobs:read",
  "admin:cron-jobs:write",
  "admin:nullclaw:read",
  "admin:export",
];

export const USER_PERMS = ["posts:read", "posts:write", "users:read"];

export function isStaff(user: SessionUser): boolean {
  return user.role === "employee" || user.role === "admin";
}

export function isAdmin(user: SessionUser): boolean {
  return user.role === "admin";
}

/** Effective permission set for a role (matches the DB seeds). */
export function rolePermissionsFor(role: string): string[] {
  if (role === "admin") return Object.keys(PERMISSIONS);
  if (role === "employee")
    return Object.keys(PERMISSIONS).filter((p) => !ADMIN_ONLY_PERMS.includes(p));
  return [...USER_PERMS];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Seconds the client should wait (sent as `Retry-After` on 429/423). */
    public retryAfter?: number,
  ) {
    super(message);
  }
}

/** DB-backed permission check (role grants are seeded in migrations). */
export async function userHasPermission(userId: string, perm: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ name: permissions.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, userId), eq(permissions.name, perm)))
    .limit(1);
  if (rows.length > 0) return true;

  // Fallback: no user_roles grants at all → derive from users.role (heals
  // accounts created before the RBAC rows were kept in sync).
  const grants = await db
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .limit(1);
  if (grants.length > 0) return false;
  const user = (
    await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (!user) return false;
  return rolePermissionsFor(user.role).includes(perm);
}

/**
 * Require a permission; throws the Rust `RbacChecker::require` failure:
 * 403 `store_error` / "store error: forbidden: missing permission: <perm>".
 */
export async function requirePermission(user: SessionUser, perm: string): Promise<void> {
  const ok = await userHasPermission(user.id, perm);
  if (!ok) throw new ApiError(403, "store_error", `forbidden: missing permission: ${perm}`);
}

/**
 * Names of the roles a user holds (Rust `get_user_permissions().role_names`).
 * Accounts with no grant rows at all fall back to the `user.role` column, the
 * same healing `userHasPermission` applies.
 */
export async function roleNamesOf(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  if (rows.length > 0) return rows.map((r) => r.name);
  const user = (
    await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  return user ? [user.role] : [];
}

/**
 * Grant `roleName` unless the user already holds it (`user_roles` has no unique
 * key, so the guard is in the statement). Unknown role names grant nothing.
 */
function grantStatement(userId: string, roleName: string) {
  return sql`INSERT INTO user_roles (user_id, role_id, assigned_at)
    SELECT ${userId}, r.id, ${new Date().toISOString()} FROM roles r
    WHERE r.name = ${roleName}
      AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = ${userId} AND ur.role_id = r.id)`;
}

/** Rust `RbacStore::assign_role`. */
export async function assignRole(userId: string, roleName: string): Promise<void> {
  await atomicBatch([grantStatement(userId, roleName)]);
}

/**
 * Rust `UserService::set_role` step 2: drop every grant and give the one role,
 * in one transaction so no reader sees the user without a role.
 */
export async function replaceRole(userId: string, roleName: string): Promise<void> {
  await atomicBatch([
    sql`DELETE FROM user_roles WHERE user_id = ${userId}`,
    grantStatement(userId, roleName),
  ]);
}

/** Rust `AuthService::is_employee`: holds any role other than `user`. */
export async function isEmployeeAccount(userId: string): Promise<boolean> {
  return (await roleNamesOf(userId)).some((name) => name !== "user");
}
