/**
 * Fixtures for the auth / users / notifications tests: a D1 migrated like
 * production, accounts with real password hashes and role grants, and request
 * builders for the route handlers.
 */
import { env } from "cloudflare:test";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import migration5 from "../../migrations/0005_repair_literal_timestamps.sql?raw";
import migration7 from "../../migrations/0007_seed_campaigns_permission.sql?raw";
import migration8 from "../../migrations/0008_user_role_without_users_read.sql?raw";
import { setCloudflareContext } from "./context";
import { applyMigrations } from "./migrate";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { assignRole } from "@/lib/auth/rbac";
import { signAccessToken } from "@/lib/auth/jwt";

export const PASSWORD = "correct-horse-battery";

export async function migrateAuth(): Promise<void> {
  setCloudflareContext();
  await applyMigrations(migration0, migration1, migration2, migration5, migration7, migration8);
}

/** Empty every table the auth tests touch (accounts, sessions, grants, devices, notifications). */
export async function resetAccounts(): Promise<void> {
  setCloudflareContext();
  await env.DB.batch(
    [
      "push_device",
      "notification",
      "refresh_tokens",
      "user_roles",
      "staff_presence_state",
      "user",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  await env.CACHE_KV.delete("probe"); // keep the binding warm; revocation keys expire on their own
}

export interface NewUser {
  role?: "user" | "employee" | "admin";
  email?: string;
  fullName?: string;
  phone?: string | null;
  /** `null` = an account with no password (social sign-in). */
  password?: string | null;
  isBot?: boolean;
  status?: string;
  grant?: boolean;
  createdAt?: string;
}

/** An account as `register`/the migrations would have left it, grants included. */
export async function createUser(o: NewUser = {}): Promise<{ id: string; email: string }> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const role = o.role ?? "user";
  const email = o.email ?? `${role}-${id.slice(0, 8)}@test.vn`;
  await db.insert(users).values({
    id,
    fullName: o.fullName ?? `Test ${role}`,
    email,
    phone: o.phone ?? null,
    role,
    isBot: o.isBot ?? false,
    status: o.status ?? "active",
    passwordHash: o.password === null ? null : await hashPassword(o.password ?? PASSWORD),
    ...(o.createdAt ? { createdAt: o.createdAt } : {}),
  });
  if (o.grant !== false) await assignRole(id, role);
  return { id, email };
}

export const bearer = async (userId: string) => ({
  authorization: `Bearer ${await signAccessToken(userId)}`,
});

export function jsonRequest(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  return new Request(`https://datxevui.com${path}`, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** `name=value` of a Set-Cookie header, by cookie name. */
export function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

export const cookieValue = (setCookieHeader: string): string =>
  decodeURIComponent(setCookieHeader.split(";")[0]!.split("=").slice(1).join("="));

/** The parsed JSON of a response, loosely typed: tests assert on the shape themselves. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = async (res: Response) => (await res.json()) as Record<string, any>;
