import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import migration5 from "../../migrations/0005_repair_literal_timestamps.sql?raw";
import { setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { LOCK_MINUTES, MAX_FAILED_ATTEMPTS } from "@/lib/auth/lockout";
import { POST as login } from "@/app/api/auth/login/route";

/**
 * Password-guessing defences over a real D1: the exact lockout (per account,
 * in the user row) and the Workers rate-limit binding in front of it.
 */
const EMAIL = "lock@test.vn";
const PASSWORD = "correct-horse-battery";
let userId = "";

function attempt(password: string, email = EMAIL): Promise<Response> {
  return login(
    new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
}

async function row() {
  const db = await getDb();
  return (await db.select().from(users).where(eq(users.id, userId)))[0];
}

beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0, migration1, migration2, migration5);
  const db = await getDb();
  userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    fullName: "Lock Tester",
    email: EMAIL,
    role: "user",
    status: "active",
    locale: "vi",
    passwordHash: await hashPassword(PASSWORD),
  });
});

beforeEach(async () => {
  setCloudflareContext();
  const db = await getDb();
  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(users.id, userId));
});

describe("login lockout", () => {
  it("locks the account after the allowed wrong passwords, even for the right one", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      expect((await attempt("wrong")).status).toBe(401);
    }
    const u = await row();
    expect(u.failedLoginAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(u.lockedUntil).not.toBeNull();

    const locked = await attempt(PASSWORD);
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { error: { code: string } }).error.code).toBe(
      "account-locked",
    );
    const retry = Number(locked.headers.get("retry-after"));
    expect(retry).toBeGreaterThan((LOCK_MINUTES - 1) * 60);
    expect(retry).toBeLessThanOrEqual(LOCK_MINUTES * 60);
  });

  it("lets the user back in once the lock has expired, and clears the counters", async () => {
    const db = await getDb();
    await db
      .update(users)
      .set({
        failedLoginAttempts: MAX_FAILED_ATTEMPTS,
        lockedUntil: new Date(Date.now() - 1000).toISOString(),
      })
      .where(eq(users.id, userId));
    const ok = await attempt(PASSWORD);
    expect(ok.status).toBe(200);
    const u = await row();
    expect(u.failedLoginAttempts).toBe(0);
    expect(u.lockedUntil).toBeNull();
  });

  it("restarts the count after an expired lock instead of re-locking at once", async () => {
    const db = await getDb();
    await db
      .update(users)
      .set({
        failedLoginAttempts: MAX_FAILED_ATTEMPTS,
        lockedUntil: new Date(Date.now() - 1000).toISOString(),
      })
      .where(eq(users.id, userId));
    expect((await attempt("wrong")).status).toBe(401);
    const u = await row();
    expect(u.failedLoginAttempts).toBe(1);
    expect(u.lockedUntil).toBeNull();
  });

  it("a successful sign-in forgives earlier failures", async () => {
    await attempt("wrong");
    await attempt("wrong");
    expect((await row()).failedLoginAttempts).toBe(2);
    expect((await attempt(PASSWORD)).status).toBe(200);
    expect((await row()).failedLoginAttempts).toBe(0);
  });

  it("holds the limit under concurrent guessing", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => attempt("wrong")));
    // Some guesses may land after the lock and see 429; none can slip past it.
    expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    const u = await row();
    expect(u.failedLoginAttempts).toBeGreaterThanOrEqual(MAX_FAILED_ATTEMPTS);
    expect(u.lockedUntil).not.toBeNull();
    expect((await attempt(PASSWORD)).status).toBe(429);
  });

  it("does not reveal whether an account exists (unknown email → plain 401)", async () => {
    const res = await attempt("whatever", "nobody@test.vn");
    expect(res.status).toBe(401);
  });
});

describe("rate-limit binding", () => {
  function limiter(allow: number) {
    const keys: string[] = [];
    return {
      keys,
      binding: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: keys.length <= allow };
        },
      },
    };
  }

  it("answers 429 with Retry-After before touching the database", async () => {
    const l = limiter(1);
    setCloudflareContext({ AUTH_LIMITER: l.binding });
    expect((await attempt("wrong")).status).toBe(401);
    const blocked = await attempt("wrong");
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("rate-limited");
    expect(blocked.headers.get("retry-after")).toBe("60");
    // The blocked attempt must not have counted as a failed password.
    expect((await row()).failedLoginAttempts).toBe(1);
  });

  it("keys on the account being tried, not on a shared bucket", async () => {
    const l = limiter(100);
    setCloudflareContext({ AUTH_LIMITER: l.binding });
    await attempt("x", EMAIL);
    await attempt("x", "other@test.vn");
    expect(l.keys).toEqual([`login:${EMAIL}`, "login:other@test.vn"]);
  });

  it("fails open when no binding is configured", async () => {
    setCloudflareContext();
    for (let i = 0; i < 3; i++) expect((await attempt("wrong")).status).toBe(401);
  });
});
