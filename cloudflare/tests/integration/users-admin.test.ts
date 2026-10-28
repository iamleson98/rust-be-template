import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:test";
import { bearer, createUser, json, jsonRequest, migrateAuth, resetAccounts } from "../helpers/auth";
import { setCloudflareContext } from "../helpers/context";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { GET as list } from "@/app/api/users/route";
import { DELETE as remove, GET as getOne } from "@/app/api/users/[id]/route";
import { PATCH as setRole } from "@/app/api/users/[id]/role/route";
import { roleNamesOf, userHasPermission } from "@/lib/auth/rbac";

/**
 * `/api/users` and the role/permission model against `routes/users.rs`,
 * `users_service.rs` and the RBAC seeds (`m20260905_000010_seed_defaults`).
 */
beforeAll(migrateAuth);
beforeEach(async () => {
  await resetAccounts();
  setCloudflareContext();
});

const as = async (id: string, method: string, path: string, body?: unknown) =>
  jsonRequest(path, { method, body, headers: await bearer(id) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const roleOf = async (id: string) =>
  (await (await getDb()).select().from(users).where(eq(users.id, id)))[0]!.role;

describe("GET /api/users", () => {
  it("pages newest-first with the real total, default 50, max 200", async () => {
    const admin = await createUser({ role: "admin", createdAt: "2026-01-01T00:00:00.000Z" });
    for (let i = 0; i < 5; i++) {
      await createUser({ createdAt: `2026-02-0${i + 1}T00:00:00.000Z`, email: `u${i}@test.vn` });
    }
    const page = await json(await list(await as(admin.id, "GET", "/api/users?limit=2&offset=1")));
    expect(page.total).toBe(6); // not "rows on this page + offset"
    expect(page.items.map((u: { email: string }) => u.email)).toEqual(["u3@test.vn", "u2@test.vn"]);
    expect(page.items[0]).toEqual({
      id: expect.any(String),
      email: "u3@test.vn",
      fullName: "Test user",
      createdAt: "2026-02-04T00:00:00.000Z",
      role: "user",
      isBot: false,
      status: "active",
    });

    const all = await json(await list(await as(admin.id, "GET", "/api/users?limit=100000")));
    expect(all.items).toHaveLength(6);
    const none = await json(await list(await as(admin.id, "GET", "/api/users?limit=0")));
    expect(none).toMatchObject({ items: [], total: 6 });
  });

  it("omits an empty email, like UserOut", async () => {
    const admin = await createUser({ role: "admin" });
    await createUser({ email: "" });
    const page = await json(await list(await as(admin.id, "GET", "/api/users")));
    const noMail = page.items.find((u: { id: string }) => u.id !== admin.id);
    expect("email" in noMail).toBe(false);
  });

  it("is for staff with users:read; customers get 403 and anonymous callers 401", async () => {
    const employee = await createUser({ role: "employee" });
    expect((await list(await as(employee.id, "GET", "/api/users"))).status).toBe(200);
    const customer = await createUser();
    const denied = await list(await as(customer.id, "GET", "/api/users"));
    expect([denied.status, (await json(denied)).message]).toEqual([
      403,
      "forbidden: missing permission: staff access required",
    ]);
    expect((await list(jsonRequest("/api/users", { method: "GET" }))).status).toBe(401);
  });

  it("rejects a malformed paging parameter", async () => {
    const admin = await createUser({ role: "admin" });
    expect((await list(await as(admin.id, "GET", "/api/users?limit=-1"))).status).toBe(400);
    expect((await list(await as(admin.id, "GET", "/api/users?offset=abc"))).status).toBe(400);
  });
});

describe("GET /api/users/{id}", () => {
  it("returns one user, 404 (store error) for a stranger, 400 for a non-UUID", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    const ok = await getOne(await as(admin.id, "GET", `/api/users/${target.id}`), ctx(target.id));
    expect((await json(ok)).id).toBe(target.id);

    const ghost = crypto.randomUUID();
    const missing = await getOne(await as(admin.id, "GET", `/api/users/${ghost}`), ctx(ghost));
    expect([missing.status, await json(missing)]).toEqual([
      404,
      { error: "store_error", message: `store error: entity not found: user ${ghost}` },
    ]);
    expect((await getOne(await as(admin.id, "GET", "/api/users/x"), ctx("x"))).status).toBe(400);
  });
});

describe("DELETE /api/users/{id}", () => {
  it("needs users:delete — an employee does not have it, an admin does", async () => {
    const employee = await createUser({ role: "employee" });
    const admin = await createUser({ role: "admin" });
    const victim = await createUser();
    const denied = await remove(
      await as(employee.id, "DELETE", `/api/users/${victim.id}`),
      ctx(victim.id),
    );
    expect([denied.status, (await json(denied)).message]).toEqual([
      403,
      "store error: forbidden: missing permission: users:delete",
    ]);
    expect(await roleOf(victim.id)).toBe("user"); // still there

    const ok = await remove(
      await as(admin.id, "DELETE", `/api/users/${victim.id}`),
      ctx(victim.id),
    );
    expect(ok.status).toBe(204);
    expect(await (await getDb()).select().from(users).where(eq(users.id, victim.id))).toHaveLength(
      0,
    );
    // Idempotent: Rust deletes by id without looking.
    expect(
      (await remove(await as(admin.id, "DELETE", `/api/users/${victim.id}`), ctx(victim.id)))
        .status,
    ).toBe(204);
  });

  it("refuses to delete oneself or the last human admin", async () => {
    const admin = await createUser({ role: "admin" });
    const self = await remove(
      await as(admin.id, "DELETE", `/api/users/${admin.id}`),
      ctx(admin.id),
    );
    expect(self.status).toBe(400);
    const other = await createUser({ role: "admin" });
    expect(
      (await remove(await as(admin.id, "DELETE", `/api/users/${other.id}`), ctx(other.id))).status,
    ).toBe(204);
    const lonely = await createUser({ role: "admin" });
    await (await getDb()).delete(users).where(eq(users.id, admin.id));
    const last = await remove(
      await as(lonely.id, "DELETE", `/api/users/${lonely.id}`),
      ctx(lonely.id),
    );
    expect(last.status).toBe(400);
  });
});

describe("PATCH /api/users/{id}/role (UserService::set_role)", () => {
  const patch = async (actor: string, target: string, role: unknown) =>
    setRole(await as(actor, "PATCH", `/api/users/${target}/role`, { role }), ctx(target));

  it("validates the role, then the permission — admins only", async () => {
    const employee = await createUser({ role: "employee" });
    const target = await createUser();
    const bad = await patch(employee.id, target.id, "superuser");
    expect([bad.status, (await json(bad)).message]).toEqual([
      400,
      "validation failed: role must be one of: user, employee, admin",
    ]);
    const denied = await patch(employee.id, target.id, "admin");
    expect([denied.status, (await json(denied)).message]).toEqual([
      403,
      "store error: forbidden: missing permission: admin:users:manage-roles",
    ]);
    const customer = await createUser();
    expect((await patch(customer.id, target.id, "admin")).status).toBe(403);
    expect(await roleOf(target.id)).toBe("user");
  });

  it("changes the column and the RBAC grant together, so permissions flip at once", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    expect(await userHasPermission(target.id, "admin:bookings:read")).toBe(false);

    const res = await patch(admin.id, target.id, "employee");
    expect(res.status).toBe(200);
    expect((await json(res)).user).toMatchObject({ id: target.id, role: "employee", isBot: false });
    expect(await roleNamesOf(target.id)).toEqual(["employee"]);
    expect(await userHasPermission(target.id, "admin:bookings:read")).toBe(true);
    expect(await userHasPermission(target.id, "users:delete")).toBe(false);

    await patch(admin.id, target.id, "admin");
    expect(await userHasPermission(target.id, "users:delete")).toBe(true);
    await patch(admin.id, target.id, "user");
    expect(await roleNamesOf(target.id)).toEqual(["user"]);
    expect(await userHasPermission(target.id, "admin:bookings:read")).toBe(false);
  });

  it("refuses bot accounts and the demotion of the last human admin", async () => {
    const admin = await createUser({ role: "admin" });
    const bot = await createUser({ role: "employee", isBot: true });
    const botRes = await patch(admin.id, bot.id, "user");
    expect([botRes.status, (await json(botRes)).message]).toEqual([
      400,
      "validation failed: bot accounts cannot change roles",
    ]);

    const last = await patch(admin.id, admin.id, "user");
    expect([last.status, await json(last)]).toEqual([
      409,
      {
        error: "conflict",
        message: "conflict: cannot demote the last admin — promote another admin first",
      },
    ]);
    // With a second human admin the demotion goes through; the bot never counted.
    const second = await createUser();
    await patch(admin.id, second.id, "admin");
    expect((await patch(admin.id, admin.id, "employee")).status).toBe(200);
  });

  it("a demoted staff member drops out of the presence table", async () => {
    const admin = await createUser({ role: "admin" });
    const staff = await createUser({ role: "employee" });
    await env.DB.prepare(
      `INSERT INTO staff_presence_state (user_id, name, role, online, last_seen_at) VALUES (?, 'S', 'employee', 1, ?)`,
    )
      .bind(staff.id, new Date().toISOString())
      .run();
    await patch(admin.id, staff.id, "user");
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM staff_presence_state`).first<{
      n: number;
    }>();
    expect(left!.n).toBe(0);
  });

  it("404 for an unknown user", async () => {
    const admin = await createUser({ role: "admin" });
    const ghost = crypto.randomUUID();
    expect((await patch(admin.id, ghost, "user")).status).toBe(404);
  });
});

describe("the seeded role model (seed_defaults)", () => {
  it("admin holds everything, employee all but the admin-only set, user three", async () => {
    const admin = await createUser({ role: "admin" });
    const employee = await createUser({ role: "employee" });
    const customer = await createUser();
    const adminOnly = [
      "users:write",
      "users:delete",
      "admin:users:manage-roles",
      "admin:cron-jobs:read",
      "admin:cron-jobs:write",
      "admin:nullclaw:read",
      "admin:export",
    ];
    for (const p of [...adminOnly, "admin:campaigns:manage"]) {
      expect(await userHasPermission(admin.id, p), p).toBe(true);
      expect(await userHasPermission(employee.id, p), p).toBe(false);
    }
    for (const p of ["admin:bookings:write", "admin:payments:read", "users:read", "posts:delete"]) {
      expect(await userHasPermission(employee.id, p), p).toBe(true);
    }
    for (const p of ["posts:read", "posts:write", "users:read"]) {
      expect(await userHasPermission(customer.id, p), p).toBe(true);
    }
    for (const p of ["posts:delete", "admin:bookings:read", "users:delete"]) {
      expect(await userHasPermission(customer.id, p), p).toBe(false);
    }
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM permissions`).first<{
      n: number;
    }>();
    expect(count!.n).toBe(32); // Rust: the 31 of seed_defaults + admin:campaigns:manage
  });
});
