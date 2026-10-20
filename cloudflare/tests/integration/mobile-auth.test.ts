import { beforeAll, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import migration5 from "../../migrations/0005_repair_literal_timestamps.sql?raw";
import { setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { POST as employeeLogin } from "@/app/api/auth/employee-login/route";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { verifyAccessToken } from "@/lib/auth/jwt";

/**
 * The Flutter agent app has no cookie jar: it logs in with `X-Client: mobile`,
 * keeps the raw tokens, and refreshes / logs out by sending the refresh token
 * in the JSON body as `refresh_token`. A duty-mode phone depends on this for
 * its whole shift — the 15-minute access token must be renewable or the app
 * drops out of the call queue.
 */
const EMAIL = "mobile-agent@test.vn";
const PASSWORD = "agent-password-123";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://x/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-client": "mobile", ...headers },
    body: JSON.stringify(body),
  });
}

type Tokens = { tokens: { access_token: string; refresh_token: string } };

async function login(): Promise<Tokens["tokens"]> {
  const res = await employeeLogin(post({ email: EMAIL, password: PASSWORD }));
  expect(res.status).toBe(200);
  return ((await res.json()) as Tokens).tokens;
}

beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0, migration1, migration2, migration5);
  const db = await getDb();
  await db.insert(users).values({
    id: crypto.randomUUID(),
    fullName: "Mobile Agent",
    email: EMAIL,
    role: "employee",
    status: "active",
    locale: "vi",
    passwordHash: await hashPassword(PASSWORD),
  });
});

describe("mobile raw-token session", () => {
  it("logs in with raw tokens in the body", async () => {
    const t = await login();
    expect(await verifyAccessToken(t.access_token)).not.toBeNull();
    expect(t.refresh_token).toMatch(/\./);
  });

  it("refreshes with {refresh_token} in the body and rotates the token", async () => {
    const t = await login();
    const res = await refresh(post({ refresh_token: t.refresh_token }));
    expect(res.status).toBe(200);
    const next = ((await res.json()) as Tokens).tokens;
    expect(await verifyAccessToken(next.access_token)).not.toBeNull();
    expect(next.refresh_token).not.toBe(t.refresh_token);
    // Rotation: the old refresh token is spent.
    expect((await refresh(post({ refresh_token: t.refresh_token }))).status).toBe(401);
  });

  it("still accepts the camelCase spelling", async () => {
    const t = await login();
    expect((await refresh(post({ refreshToken: t.refresh_token }))).status).toBe(200);
  });

  it("logout with the token in the body really revokes that session", async () => {
    const t = await login();
    expect((await logout(post({ refresh_token: t.refresh_token }))).status).toBe(204);
    expect((await refresh(post({ refresh_token: t.refresh_token }))).status).toBe(401);
  });

  it("rejects a missing or bogus refresh token", async () => {
    expect((await refresh(post({}))).status).toBe(401);
    expect((await refresh(post({ refresh_token: "nope" }))).status).toBe(401);
  });
});
