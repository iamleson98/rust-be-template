import { beforeAll, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import { setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { users, refreshTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { issueSession, rotateRefresh, revokeSession, currentUser } from "@/lib/auth/session";
import { signAccessToken, verifyAccessToken } from "@/lib/auth/jwt";

/**
 * Auth session lifecycle over a real D1 — issue → use → rotate → revoke,
 * exactly the flow the login/refresh/logout routes drive.
 */
beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0);
  const db = await getDb();
  await db.insert(users).values({
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Session Tester",
    email: "session@test.vn",
    role: "user",
    status: "active",
    locale: "vi",
  });
});

describe("access tokens (JWT)", () => {
  it("signs and verifies with the env secret", async () => {
    const token = await signAccessToken("11111111-1111-4111-8111-111111111111");
    const claims = await verifyAccessToken(token);
    expect(claims?.sub).toBe("11111111-1111-4111-8111-111111111111");
    expect(claims?.typ).toBe("access");
    expect(claims?.iss).toBe("backend");
  });

  it("rejects garbage tokens", async () => {
    expect(await verifyAccessToken("not-a-jwt")).toBeNull();
  });
});

describe("refresh token rotation (issueSession / rotateRefresh)", () => {
  it("issues a stored, hash-checked refresh token", async () => {
    const issued = await issueSession("11111111-1111-4111-8111-111111111111", {});
    const db = await getDb();
    const row = (await db.select().from(refreshTokens).where(eq(refreshTokens.id, issued.refreshId)).limit(1))[0];
    expect(row?.revoked).toBe(false);
    // DB stores an HMAC digest, never the raw secret
    expect(row?.tokenHash).not.toContain(issued.refreshToken.split(".")[1]!);
    expect(row?.tokenHash).toHaveLength(64);
  });

  it("rotates: old token revoked, new token works, old token dead", async () => {
    const first = await issueSession("11111111-1111-4111-8111-111111111111", {});
    const rotated = await rotateRefresh(first.refreshToken, {});
    expect(rotated).not.toBeNull();
    expect(rotated!.refreshId).not.toBe(first.refreshId);

    // old token can never rotate again (replay protection)
    const replay = await rotateRefresh(first.refreshToken, {});
    expect(replay).toBeNull();

    // new token still rotates once (chained sessions)
    const chained = await rotateRefresh(rotated!.refreshToken, {});
    expect(chained).not.toBeNull();
  });

  it("rejects unknown/garbage refresh tokens", async () => {
    expect(await rotateRefresh("totally-invalid", {})).toBeNull();
    expect(await rotateRefresh("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.deadbeef", {})).toBeNull();
  });
});

describe("currentUser (request resolution)", () => {
  it("resolves a bearer token to the active session user", async () => {
    const token = await signAccessToken("11111111-1111-4111-8111-111111111111");
    const req = new Request("https://datxevui.com/api/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    const user = await currentUser(req);
    expect(user?.email).toBe("session@test.vn");
    expect(user?.role).toBe("user");
  });

  it("resolves the access_token cookie when no header is present", async () => {
    const token = await signAccessToken("11111111-1111-4111-8111-111111111111");
    const req = new Request("https://datxevui.com/api/auth/me", {
      headers: { cookie: `access_token=${encodeURIComponent(token)}` },
    });
    const user = await currentUser(req);
    expect(user?.id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("returns null without credentials and for inactive users", async () => {
    expect(await currentUser(new Request("https://datxevui.com/api/auth/me"))).toBeNull();
    const token = await signAccessToken("22222222-2222-4222-8222-222222222222");
    expect(await currentUser(new Request("https://x/", { headers: { authorization: `Bearer ${token}` } }))).toBeNull();
  });
});

describe("revokeSession", () => {
  it("revokes a single session, leaving others intact", async () => {
    const keep = await issueSession("11111111-1111-4111-8111-111111111111", {});
    const kill = await issueSession("11111111-1111-4111-8111-111111111111", {});
    await revokeSession(kill.refreshToken);
    expect(await rotateRefresh(kill.refreshToken, {})).toBeNull();
    expect(await rotateRefresh(keep.refreshToken, {})).not.toBeNull();
  });
});
