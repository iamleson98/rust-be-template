import { beforeAll, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import { BASE_TEST_ENV, setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { users, refreshTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { issueSession, refreshSession, logoutSession, currentUser } from "@/lib/auth/session";
import { signAccessToken, verifyAccessToken } from "@/lib/auth/jwt";

const USER = "11111111-1111-4111-8111-111111111111";

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

  // Rust jwt.rs: verify_rejects_wrong_secret.
  it("rejects a token signed with another secret", async () => {
    const token = await signAccessToken(USER);
    setCloudflareContext({ JWT_SECRET: "a-completely-different-secret-9876543210xyz" });
    expect(await verifyAccessToken(token)).toBeNull();
    setCloudflareContext();
    expect(await verifyAccessToken(token)).not.toBeNull();
  });

  it("carries and checks the configured issuer (JWT_ISSUER, default backend)", async () => {
    setCloudflareContext({ JWT_ISSUER: "test-issuer" });
    const token = await signAccessToken(USER);
    expect((await verifyAccessToken(token))?.iss).toBe("test-issuer");
    setCloudflareContext();
    expect(await verifyAccessToken(token)).toBeNull();
  });

  const hand = async (claims: Record<string, unknown>, alg = "HS256") => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(BASE_TEST_ENV.JWT_SECRET as string);
    return new SignJWT(claims).setProtectedHeader({ alg }).sign(secret);
  };
  const now = () => Math.floor(Date.now() / 1000);

  it("allows 30 s of clock skew and not a second more", async () => {
    const claims = { sub: USER, iss: "backend", typ: "access", iat: now() - 900 };
    expect(await verifyAccessToken(await hand({ ...claims, exp: now() - 20 }))).not.toBeNull();
    expect(await verifyAccessToken(await hand({ ...claims, exp: now() - 40 }))).toBeNull();
  });

  it("accepts only HS256 access tokens with a UUID subject and an expiry", async () => {
    const ok = { sub: USER, iss: "backend", iat: now(), exp: now() + 60 };
    expect(await verifyAccessToken(await hand({ ...ok, typ: "access" }))).not.toBeNull();
    expect(await verifyAccessToken(await hand({ ...ok, typ: "refresh" }))).toBeNull();
    expect(await verifyAccessToken(await hand({ ...ok, typ: "access" }, "HS384"))).toBeNull();
    expect(await verifyAccessToken(await hand({ ...ok, typ: "access", sub: "admin" }))).toBeNull();
    expect(
      await verifyAccessToken(await hand({ sub: USER, iss: "backend", iat: now(), typ: "access" })),
    ).toBeNull();
  });
});

describe("refresh token rotation (issueSession / rotateRefresh)", () => {
  it("issues a stored, hash-checked refresh token", async () => {
    const issued = await issueSession("11111111-1111-4111-8111-111111111111", {});
    const db = await getDb();
    const row = (
      await db.select().from(refreshTokens).where(eq(refreshTokens.id, issued.refreshId)).limit(1)
    )[0];
    expect(row?.revoked).toBe(false);
    // DB stores an HMAC digest, never the raw secret
    expect(row?.tokenHash).not.toContain(issued.refreshToken.split(".")[1]!);
    expect(row?.tokenHash).toHaveLength(64);
  });

  it("rotates: old token revoked, new token works, old token dead", async () => {
    const first = await issueSession("11111111-1111-4111-8111-111111111111", {});
    const rotated = await refreshSession(first.refreshToken);
    expect(rotated.refreshId).not.toBe(first.refreshId);

    // old token can never rotate again (replay protection)
    await expect(refreshSession(first.refreshToken)).rejects.toMatchObject({
      status: 401,
      message: "refresh token expired",
    });

    // new token still rotates once (chained sessions)
    await expect(refreshSession(rotated.refreshToken)).resolves.toBeDefined();
  });

  it("answers each failure like Rust (verified_refresh_token)", async () => {
    // Not `<uuid>.<secret>`: 400, not 401.
    await expect(refreshSession("totally-invalid")).rejects.toMatchObject({
      status: 400,
      message: "malformed refresh token",
    });
    await expect(refreshSession("not-a-uuid.deadbeef")).rejects.toMatchObject({ status: 400 });
    // Well-formed but never issued.
    await expect(
      refreshSession("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.deadbeef"),
    ).rejects.toMatchObject({ status: 401, message: "unknown refresh token" });
    // Right id, wrong secret.
    const real = await issueSession("11111111-1111-4111-8111-111111111111");
    await expect(refreshSession(`${real.refreshId}.not-the-secret`)).rejects.toMatchObject({
      status: 401,
      message: "refresh token mismatch",
    });
    // The wrong guess must not have spent the real token.
    await expect(refreshSession(real.refreshToken)).resolves.toBeDefined();
  });

  it("expired tokens are refused", async () => {
    const t = await issueSession("11111111-1111-4111-8111-111111111111");
    const db = await getDb();
    await db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(refreshTokens.id, t.refreshId));
    await expect(refreshSession(t.refreshToken)).rejects.toMatchObject({
      status: 401,
      message: "refresh token expired",
    });
  });

  it("two concurrent refreshes of one token: exactly one wins", async () => {
    const t = await issueSession("11111111-1111-4111-8111-111111111111");
    const results = await Promise.allSettled([
      refreshSession(t.refreshToken),
      refreshSession(t.refreshToken),
      refreshSession(t.refreshToken),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("mobile sessions live 90 days, browser sessions 7 (JWT_*_REFRESH_TTL_SECS)", async () => {
    const lifetime = async (kind: "browser" | "mobile") => {
      const t = await issueSession("11111111-1111-4111-8111-111111111111", { kind });
      const db = await getDb();
      const row = (
        await db.select().from(refreshTokens).where(eq(refreshTokens.id, t.refreshId))
      )[0]!;
      return Math.round((Date.parse(row.expiresAt) - Date.parse(row.issuedAt)) / 1000);
    };
    expect(await lifetime("browser")).toBe(7 * 24 * 3600);
    expect(await lifetime("mobile")).toBe(90 * 24 * 3600);
    setCloudflareContext({ JWT_REFRESH_TTL_SECS: "120", JWT_MOBILE_REFRESH_TTL_SECS: "240" });
    expect(await lifetime("browser")).toBe(120);
    expect(await lifetime("mobile")).toBe(240);
    setCloudflareContext();
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
    expect(
      await currentUser(
        new Request("https://x/", { headers: { authorization: `Bearer ${token}` } }),
      ),
    ).toBeNull();
  });
});

describe("logoutSession", () => {
  it("revokes a single session, leaving others intact", async () => {
    const keep = await issueSession(USER);
    const kill = await issueSession(USER);
    await logoutSession({
      userId: USER,
      refreshToken: kill.refreshToken,
      accessToken: null,
      all: false,
    });
    await expect(refreshSession(kill.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(refreshSession(keep.refreshToken)).resolves.toBeDefined();
  });

  it("`all` revokes every session of the user and every access token issued so far", async () => {
    const a = await issueSession(USER);
    const b = await issueSession(USER);
    await new Promise((r) => setTimeout(r, 1100)); // iat has second resolution
    await logoutSession({ userId: USER, refreshToken: null, accessToken: null, all: true });
    await expect(refreshSession(a.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(refreshSession(b.refreshToken)).rejects.toMatchObject({ status: 401 });
    const stale = new Request("https://x/", {
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect(await currentUser(stale)).toBeNull();
    // A session started after the logout is not affected.
    await new Promise((r) => setTimeout(r, 1100));
    const fresh = await issueSession(USER);
    const req = new Request("https://x/", {
      headers: { authorization: `Bearer ${fresh.accessToken}` },
    });
    expect((await currentUser(req))?.id).toBe(USER);
  });

  it("revokes the presented access token at once, not the user's other tokens", async () => {
    const mine = await issueSession(USER);
    const other = await issueSession(USER);
    await logoutSession({
      userId: USER,
      refreshToken: mine.refreshToken,
      accessToken: mine.accessToken,
      all: false,
    });
    const as = (t: string) =>
      new Request("https://x/", { headers: { authorization: `Bearer ${t}` } });
    expect(await currentUser(as(mine.accessToken))).toBeNull();
    expect((await currentUser(as(other.accessToken)))?.id).toBe(USER);
  });

  it("cannot revoke another user's session by naming its token", async () => {
    const theirs = await issueSession(USER);
    await logoutSession({
      userId: "99999999-9999-4999-8999-999999999999",
      refreshToken: theirs.refreshToken,
      accessToken: null,
      all: false,
    });
    await expect(refreshSession(theirs.refreshToken)).resolves.toBeDefined();
  });

  it("without an access token, a verified refresh token still logs its session out", async () => {
    const t = await issueSession(USER);
    await logoutSession({
      userId: null,
      refreshToken: t.refreshToken,
      accessToken: null,
      all: false,
    });
    await expect(refreshSession(t.refreshToken)).rejects.toMatchObject({ status: 401 });
    // A forged token for a real id revokes nothing.
    const victim = await issueSession(USER);
    await logoutSession({
      userId: null,
      refreshToken: `${victim.refreshId}.forged`,
      accessToken: null,
      all: false,
    });
    await expect(refreshSession(victim.refreshToken)).resolves.toBeDefined();
  });
});
