import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:test";
import {
  PASSWORD,
  bearer,
  cookieValue,
  createUser,
  json,
  jsonRequest,
  migrateAuth,
  resetAccounts,
  setCookie,
} from "../helpers/auth";
import { setCloudflareContext } from "../helpers/context";
import { getDb } from "@/lib/db/client";
import { refreshTokens, roles, userRoles, users } from "@/lib/db/schema";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as employeeLogin } from "@/app/api/auth/employee-login/route";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as changePassword } from "@/app/api/auth/password/route";
import { GET as me } from "@/app/api/auth/me/route";
import { NULLCLAW_BOT_EMAIL } from "@/lib/auth/auth-service";

/**
 * The auth routes against the Rust spec (`auth_service.rs`, `routes/auth.rs`):
 * statuses, message text, limits, cookies, session rotation.
 */
beforeAll(migrateAuth);
beforeEach(async () => {
  await resetAccounts();
  setCloudflareContext();
});

const signUp = (b: Record<string, unknown>, headers?: Record<string, string>) =>
  register(jsonRequest("/api/auth/register", { body: b, headers }));
const valid = {
  fullName: "Nguyễn Văn An",
  email: "an@test.vn",
  password: "long-enough-password",
};
const dbUser = async (email: string) =>
  (await (await getDb()).select().from(users).where(eq(users.email, email)))[0]!;
const grantsOf = async (userId: string) =>
  (
    await (
      await getDb()
    )
      .select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
  ).map((r) => r.name);

describe("register (AuthService::register)", () => {
  it("the first HUMAN account is admin, later ones are users", async () => {
    const first = await signUp(valid);
    expect(first.status).toBe(200);
    expect((await json(first)).user.role).toBe("admin");
    expect(await grantsOf((await dbUser(valid.email)).id)).toEqual(["admin"]);

    const second = await signUp({ ...valid, email: "binh@test.vn" });
    expect((await json(second)).user.role).toBe("user");
    expect(await grantsOf((await dbUser("binh@test.vn")).id)).toEqual(["user"]);
  });

  it("creates the NullClaw bot on first signup: employee, is_bot, employee grant", async () => {
    await signUp(valid);
    const bot = await dbUser(NULLCLAW_BOT_EMAIL);
    expect([bot.role, bot.isBot]).toEqual(["employee", true]);
    expect(await grantsOf(bot.id)).toEqual(["employee"]);
    // The bot never signs in: its stored "hash" is no hash.
    const res = await login(
      jsonRequest("/api/auth/login", {
        body: { email: NULLCLAW_BOT_EMAIL, password: "hashed_password" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("a database holding only the bot still promotes the next human to admin", async () => {
    await createUser({ role: "employee", isBot: true, email: NULLCLAW_BOT_EMAIL });
    expect((await json(await signUp(valid))).user.role).toBe("admin");
  });

  it("answers the Rust AuthResponse and sets both cookies", async () => {
    const res = await signUp(valid);
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.user).toMatchObject({
      type: "admin",
      role: "admin",
      name: valid.fullName,
      email: valid.email,
      phone: null,
      avatarUrl: null,
      brandId: null,
      brandName: null,
      employeeRole: "admin",
      hasPassword: true,
    });
    expect(Date.parse(out.expires_at) - Date.now()).toBeGreaterThan(890_000);
    expect(out.tokens).toBeUndefined(); // browsers authenticate with cookies

    const access = setCookie(res, "access_token")!;
    const refreshCookie = setCookie(res, "refresh_token")!;
    for (const [c, ttl] of [
      [access, 900],
      [refreshCookie, 604800],
    ] as const) {
      expect(c).toContain("Path=/");
      expect(c).toContain("HttpOnly");
      expect(c).toContain("SameSite=Lax");
      expect(c).toContain(`Max-Age=${ttl}`);
    }
  });

  it("includes the raw token pair only for X-Client: mobile (trimmed, any case)", async () => {
    const res = await signUp(valid, { "x-client": " Mobile " });
    const out = await json(res);
    expect(out.tokens.refresh_token).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
    expect(out.tokens.access_token.split(".")).toHaveLength(3);
    const web = await signUp({ ...valid, email: "x@test.vn" }, { "x-client": "web" });
    expect((await json(web)).tokens).toBeUndefined();
  });

  it("applies the DTO limits, worded like AppError::from_validation_errors", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...valid, fullName: "" }, "full name has an invalid length"],
      [{ ...valid, fullName: "x".repeat(129) }, "full name has an invalid length"],
      [{ ...valid, email: "not-an-email" }, "email must be a valid email address"],
      [{ ...valid, phone: "12345" }, "phone must be a valid phone number"],
      [{ ...valid, phone: "" }, "phone cannot be empty"],
      [{ ...valid, phone: "0".repeat(21) }, "phone has an invalid length"],
      [{ ...valid, password: "short" }, "password has an invalid length"],
      [{ ...valid, password: "p".repeat(129) }, "password has an invalid length"],
    ];
    for (const [input, message] of cases) {
      const res = await signUp(input);
      expect([res.status, (await json(res)).message], JSON.stringify(input)).toEqual([
        400,
        expect.stringContaining(`validation failed: ${message}`),
      ]);
    }
  });

  it("needs an email or a phone", async () => {
    const res = await signUp({ fullName: valid.fullName, password: valid.password });
    expect([res.status, await json(res)]).toEqual([
      400,
      { error: "validation_error", message: "validation failed: Email or phone is required" },
    ]);
  });

  it("the service rule on the name counts bytes: 3–64", async () => {
    const short = await signUp({ ...valid, fullName: "An" });
    expect([short.status, (await json(short)).message]).toEqual([
      400,
      "validation failed: username must be 3-64 characters",
    ]);
    const long = await signUp({ ...valid, fullName: "ế".repeat(22) }); // 22 chars, 66 bytes
    expect(long.status).toBe(400);
    expect((await signUp({ ...valid, fullName: "Lê" })).status).toBe(200); // 3 bytes
  });

  it("a taken email is a 409, whatever its case", async () => {
    await signUp(valid);
    for (const email of [valid.email, valid.email.toUpperCase()]) {
      const res = await signUp({ ...valid, email });
      expect([res.status, (await json(res)).error]).toEqual([409, "conflict"]);
    }
  });

  it("a phone-only signup works and several can coexist", async () => {
    const a = await signUp({ fullName: "Phone A", phone: "0912345678", password: valid.password });
    expect(a.status).toBe(200);
    expect((await json(a)).user.phone).toBe("+84912345678");
    const b = await signUp({ fullName: "Phone B", phone: "0912345679", password: valid.password });
    expect(b.status).toBe(200);
    const dup = await signUp({
      fullName: "Phone C",
      phone: "0912345678",
      password: valid.password,
    });
    expect(dup.status).toBe(409);
    // ...and either can sign in with its number.
    const res = await login(
      jsonRequest("/api/auth/login", { body: { phone: "0912345678", password: valid.password } }),
    );
    expect(res.status).toBe(200);
  });
});

describe("login (AuthService::login, LoginRequest)", () => {
  it("wrong password and unknown email are the same 401", async () => {
    const { email } = await createUser();
    for (const [e, p] of [
      [email, "wrong-password"],
      ["nobody@test.vn", PASSWORD],
    ]) {
      const res = await login(jsonRequest("/api/auth/login", { body: { email: e, password: p } }));
      expect([res.status, await json(res)]).toEqual([
        401,
        { error: "unauthorized", message: "unauthorized: invalid credentials" },
      ]);
    }
  });

  it("an account without a password cannot sign in with one", async () => {
    const { email } = await createUser({ password: null });
    const res = await login(
      jsonRequest("/api/auth/login", { body: { email, password: "anything-1" } }),
    );
    expect(res.status).toBe(401);
  });

  it("validates the body: email format ≤ 255, password 1–255", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ email: "nope", password: "x" }, "email must be a valid email address"],
      [{ email: `${"a".repeat(250)}@t.vn`, password: "x" }, "email"],
      [{ email: "a@test.vn", password: "" }, "password has an invalid length"],
      [{ email: "a@test.vn", password: "p".repeat(256) }, "password has an invalid length"],
      [{ password: "x" }, "email must be a valid email address"],
    ];
    for (const [input, message] of cases) {
      const res = await login(jsonRequest("/api/auth/login", { body: input }));
      expect([res.status, (await json(res)).message]).toEqual([
        400,
        expect.stringContaining(message),
      ]);
    }
  });

  it("matches the email as stored — a Rust account with capitals still signs in", async () => {
    await createUser({ email: "Mixed.Case@Test.vn" });
    for (const email of ["Mixed.Case@Test.vn", "mixed.case@test.vn"]) {
      const res = await login(
        jsonRequest("/api/auth/login", { body: { email, password: PASSWORD } }),
      );
      expect(res.status, email).toBe(200);
    }
  });

  it("issues cookies, stores only a hash, and returns tokens for mobile", async () => {
    const { id, email } = await createUser();
    const res = await login(
      jsonRequest("/api/auth/login", {
        body: { email, password: PASSWORD },
        headers: { "x-client": "mobile" },
      }),
    );
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.user.id).toBe(id);
    expect(out.tokens.access_token).toBe(cookieValue(setCookie(res, "access_token")!));
    const stored = (await (await getDb()).select().from(refreshTokens))[0]!;
    expect(stored.tokenHash).toHaveLength(64);
    expect(out.tokens.refresh_token).not.toContain(stored.tokenHash);
  });

  it("refuses a blocked account only to someone who knew its password", async () => {
    const { email } = await createUser({ status: "blocked" });
    const wrong = await login(
      jsonRequest("/api/auth/login", { body: { email, password: "nope-nope" } }),
    );
    expect(wrong.status).toBe(401);
    const right = await login(
      jsonRequest("/api/auth/login", { body: { email, password: PASSWORD } }),
    );
    expect(right.status).toBe(403);
  });
});

describe("employee-login", () => {
  it("lets staff in and tells a customer 403 — after the password check", async () => {
    const staff = await createUser({ role: "employee" });
    const customer = await createUser({ role: "user" });
    const ok = await employeeLogin(
      jsonRequest("/api/auth/employee-login", { body: { email: staff.email, password: PASSWORD } }),
    );
    expect(ok.status).toBe(200);

    const forbidden = await employeeLogin(
      jsonRequest("/api/auth/employee-login", {
        body: { email: customer.email, password: PASSWORD },
      }),
    );
    expect([forbidden.status, await json(forbidden)]).toEqual([
      403,
      {
        error: "forbidden",
        message: "forbidden: missing permission: This endpoint is for employees only",
      },
    ]);
    const wrong = await employeeLogin(
      jsonRequest("/api/auth/employee-login", {
        body: { email: customer.email, password: "bad-bad-bad" },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it("decides on the role grants (any role but `user`), as Rust does", async () => {
    const { email, id } = await createUser({ role: "user" });
    const db = await getDb();
    await db
      .update(userRoles)
      .set({ roleId: (await db.select().from(roles).where(eq(roles.name, "admin")))[0]!.id })
      .where(eq(userRoles.userId, id));
    const res = await employeeLogin(
      jsonRequest("/api/auth/employee-login", { body: { email, password: PASSWORD } }),
    );
    expect(res.status).toBe(200);
  });
});

describe("me", () => {
  it("401 says whether the token is missing or bad", async () => {
    const none = await me(new Request("https://datxevui.com/api/auth/me"));
    expect([none.status, (await json(none)).message]).toEqual([
      401,
      "unauthorized: missing access token",
    ]);
    const bad = await me(
      new Request("https://datxevui.com/api/auth/me", {
        headers: { authorization: "Bearer junk" },
      }),
    );
    expect((await json(bad)).message).toBe("unauthorized: invalid or expired token");
  });

  it("reports hasPassword and sets no cookies", async () => {
    const social = await createUser({ password: null });
    const res = await me(
      new Request("https://datxevui.com/api/auth/me", { headers: await bearer(social.id) }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).user.hasPassword).toBe(false);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("a deleted account's token stops working", async () => {
    const { id } = await createUser();
    const headers = await bearer(id);
    await (await getDb()).delete(users).where(eq(users.id, id));
    expect((await me(new Request("https://datxevui.com/api/auth/me", { headers }))).status).toBe(
      401,
    );
  });
});

describe("refresh", () => {
  async function signedIn(extra: Record<string, string> = {}) {
    const { email } = await createUser();
    const res = await login(
      jsonRequest("/api/auth/login", { body: { email, password: PASSWORD }, headers: extra }),
    );
    return { res, refreshToken: cookieValue(setCookie(res, "refresh_token")!) };
  }

  it("rotates through the cookie and sets fresh cookies", async () => {
    const { refreshToken } = await signedIn();
    const res = await refresh(
      jsonRequest("/api/auth/refresh", {
        body: {},
        headers: { cookie: `refresh_token=${refreshToken}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(cookieValue(setCookie(res, "refresh_token")!)).not.toBe(refreshToken);
    const replay = await refresh(
      jsonRequest("/api/auth/refresh", {
        body: {},
        headers: { cookie: `refresh_token=${refreshToken}` },
      }),
    );
    expect([replay.status, (await json(replay)).message]).toEqual([
      401,
      "unauthorized: refresh token expired",
    ]);
  });

  it("the cookie wins over the body", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const res = await refresh(
      jsonRequest("/api/auth/refresh", {
        body: { refresh_token: b.refreshToken },
        headers: { cookie: `refresh_token=${a.refreshToken}` },
      }),
    );
    expect(res.status).toBe(200);
    // `a` was spent, `b` untouched.
    const again = await refresh(
      jsonRequest("/api/auth/refresh", { body: { refresh_token: b.refreshToken } }),
    );
    expect(again.status).toBe(200);
  });

  it("no token at all is a 401 `missing refresh token`", async () => {
    const res = await refresh(jsonRequest("/api/auth/refresh", { body: {} }));
    expect([res.status, (await json(res)).message]).toEqual([
      401,
      "unauthorized: missing refresh token",
    ]);
    const noBody = await refresh(
      new Request("https://datxevui.com/api/auth/refresh", { method: "POST" }),
    );
    expect(noBody.status).toBe(401);
  });

  it("a cookie that does not percent-decode is ignored, not a 500", async () => {
    const res = await refresh(
      jsonRequest("/api/auth/refresh", { body: {}, headers: { cookie: "refresh_token=%E0%A4%A" } }),
    );
    expect(res.status).toBe(401);
  });

  it("the response user carries the account's real hasPassword", async () => {
    const { res } = await signedIn();
    expect((await json(res)).user.hasPassword).toBe(true);
  });
});

describe("logout", () => {
  it("answers 204 and clears both cookies with the attributes they were set with", async () => {
    setCloudflareContext({ COOKIE_DOMAIN: "example.test", COOKIE_SECURE: "true" });
    const res = await logout(jsonRequest("/api/auth/logout"));
    expect(res.status).toBe(204);
    for (const name of ["access_token", "refresh_token"]) {
      const c = setCookie(res, name)!;
      expect(c).toContain("Max-Age=0");
      expect(c).toContain("Path=/");
      expect(c).toContain("HttpOnly");
      expect(c).toContain("Domain=example.test");
      expect(c).toContain("Secure");
    }
  });

  it("with only the refresh cookie it still ends that session", async () => {
    const { email } = await createUser();
    const res = await login(
      jsonRequest("/api/auth/login", { body: { email, password: PASSWORD } }),
    );
    const token = cookieValue(setCookie(res, "refresh_token")!);
    const out = await logout(
      jsonRequest("/api/auth/logout", { headers: { cookie: `refresh_token=${token}` } }),
    );
    expect(out.status).toBe(204);
    const again = await refresh(
      jsonRequest("/api/auth/refresh", { body: { refresh_token: token } }),
    );
    expect(again.status).toBe(401);
  });

  it("signing out one device leaves the other signed in; `all` ends both", async () => {
    const { email } = await createUser();
    const sign = async () => {
      const res = await login(
        jsonRequest("/api/auth/login", { body: { email, password: PASSWORD } }),
      );
      return {
        refreshToken: cookieValue(setCookie(res, "refresh_token")!),
        accessToken: cookieValue(setCookie(res, "access_token")!),
      };
    };
    const phone = await sign();
    const web = await sign();
    const asWeb = (extra: object = {}) =>
      jsonRequest("/api/auth/logout", {
        body: extra,
        headers: {
          authorization: `Bearer ${web.accessToken}`,
          cookie: `refresh_token=${web.refreshToken}`,
        },
      });

    await logout(asWeb());
    expect(
      (
        await refresh(
          jsonRequest("/api/auth/refresh", { body: { refresh_token: web.refreshToken } }),
        )
      ).status,
    ).toBe(401);
    // The phone's session is untouched.
    const kept = await refresh(
      jsonRequest("/api/auth/refresh", { body: { refresh_token: phone.refreshToken } }),
    );
    expect(kept.status).toBe(200);
    const renewed = cookieValue(setCookie(kept, "refresh_token")!);
    const renewedAccess = cookieValue(setCookie(kept, "access_token")!);

    await new Promise((r) => setTimeout(r, 1100));
    await logout(
      jsonRequest("/api/auth/logout", {
        body: { all: true },
        headers: { authorization: `Bearer ${renewedAccess}` },
      }),
    );
    expect(
      (await refresh(jsonRequest("/api/auth/refresh", { body: { refresh_token: renewed } })))
        .status,
    ).toBe(401);
  });

  it("a garbage body is ignored", async () => {
    const res = await logout(
      new Request("https://datxevui.com/api/auth/logout", { method: "POST", body: "{{not json" }),
    );
    expect(res.status).toBe(204);
  });
});

describe("change password (AuthService::change_password)", () => {
  const change = (headers: Record<string, string>, b: Record<string, unknown>) =>
    changePassword(jsonRequest("/api/auth/password", { body: b, headers }));

  it("needs the current password, and a wrong one is a 400 that keeps the session", async () => {
    const { id } = await createUser();
    const headers = await bearer(id);
    for (const current of [undefined, "", "not-the-password"]) {
      const res = await change(headers, {
        currentPassword: current,
        newPassword: "brand-new-password",
      });
      expect([res.status, await json(res)]).toEqual([
        400,
        { error: "bad_request", message: "bad request: current password is incorrect" },
      ]);
    }
    // The web client recognises this error by the words "current password".
    expect(
      (await json(await change(headers, { newPassword: "brand-new-password" }))).message,
    ).toMatch(/current password/i);
  });

  it("validates the new password length (8–128) and the current one (≤ 255)", async () => {
    const headers = await bearer((await createUser()).id);
    const short = await change(headers, { currentPassword: PASSWORD, newPassword: "short" });
    expect([short.status, (await json(short)).message]).toEqual([
      400,
      "validation failed: new password has an invalid length",
    ]);
    const huge = await change(headers, {
      currentPassword: "p".repeat(256),
      newPassword: "long-enough-pw",
    });
    expect(huge.status).toBe(400);
  });

  it("an account made through a social sign-in sets its first password without one", async () => {
    const { id, email } = await createUser({ password: null });
    const res = await change(await bearer(id), { newPassword: "first-ever-password" });
    expect(res.status).toBe(200);
    expect((await json(res)).user.hasPassword).toBe(true);
    const signIn = await login(
      jsonRequest("/api/auth/login", { body: { email, password: "first-ever-password" } }),
    );
    expect(signIn.status).toBe(200);
  });

  it("signs every other device out and hands this one a fresh session", async () => {
    const { id, email } = await createUser();
    const other = await login(
      jsonRequest("/api/auth/login", { body: { email, password: PASSWORD } }),
    );
    const otherRefresh = cookieValue(setCookie(other, "refresh_token")!);

    const res = await change(await bearer(id), {
      currentPassword: PASSWORD,
      newPassword: "brand-new-password",
    });
    expect(res.status).toBe(200);
    expect(setCookie(res, "access_token")).toBeDefined();
    const fresh = cookieValue(setCookie(res, "refresh_token")!);

    expect(
      (await refresh(jsonRequest("/api/auth/refresh", { body: { refresh_token: otherRefresh } })))
        .status,
    ).toBe(401);
    expect(
      (await refresh(jsonRequest("/api/auth/refresh", { body: { refresh_token: fresh } }))).status,
    ).toBe(200);
    // The old password is gone, the new one works.
    const old = await login(
      jsonRequest("/api/auth/login", { body: { email, password: PASSWORD } }),
    );
    expect(old.status).toBe(401);
    const live = await db(id);
    expect(live.passwordChangedAt).not.toBeNull();
  });

  it("is for signed-in users only", async () => {
    const res = await change({}, { newPassword: "brand-new-password" });
    expect(res.status).toBe(401);
  });
});

async function db(id: string) {
  return (await (await getDb()).select().from(users).where(eq(users.id, id)))[0]!;
}

describe("sanity", () => {
  it("revoked flag really lives in D1 (guards the tests above)", async () => {
    const { email } = await createUser();
    await login(jsonRequest("/api/auth/login", { body: { email, password: PASSWORD } }));
    const rows = await (
      await getDb()
    )
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.revoked, false)));
    expect(rows).toHaveLength(1);
    expect(env.DB).toBeDefined();
  });
});
