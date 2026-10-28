import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  PASSWORD,
  cookieValue,
  createUser,
  migrateAuth,
  resetAccounts,
  setCookie,
} from "../helpers/auth";
import { setCloudflareContext } from "../helpers/context";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { GET as providers } from "@/app/api/auth/oauth/providers/route";
import { GET as start } from "@/app/api/auth/oauth/[provider]/start/route";
import { GET as callback } from "@/app/api/auth/oauth/[provider]/callback/route";
import { callbackUrl, enabledProvider, generateState, urlEncode } from "@/lib/auth/oauth";

/**
 * OAuth against `routes/oauth.rs` and `auth/oauth/{google,facebook}.rs`:
 * which providers are on, the state cookie, every error redirect, and the
 * account created or linked by a successful callback. The providers' HTTP
 * endpoints are stubbed at `fetch`.
 */
const OAUTH_ENV = {
  OAUTH_REDIRECT_BASE_URL: "https://datxevui.com/",
  OAUTH_FRONTEND_URL: "https://app.datxevui.com/",
  OAUTH_GOOGLE_ENABLED: "true",
  OAUTH_GOOGLE_CLIENT_ID: "123",
  OAUTH_GOOGLE_CLIENT_SECRET: "secret",
  OAUTH_FACEBOOK_ENABLED: "true",
  OAUTH_FACEBOOK_CLIENT_ID: "456",
  OAUTH_FACEBOOK_CLIENT_SECRET: "fb-secret",
};

beforeAll(migrateAuth);
beforeEach(async () => {
  await resetAccounts();
  setCloudflareContext(OAUTH_ENV);
});
afterEach(() => vi.unstubAllGlobals());

const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://datxevui.com${path}`, { headers });
const started = async (provider = "google", origin = "https://datxevui.com") => {
  const res = await start(new Request(`${origin}/api/auth/oauth/${provider}/start`), ctx(provider));
  const state = cookieValue(setCookie(res, `oauth_state_${provider}`)!);
  return { res, state };
};
const location = (res: Response) => res.headers.get("location")!;

/** Stub the provider's token and profile endpoints. */
function stubProvider(profile: Record<string, unknown>, tokenOk = true, profileOk = true) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith("https://oauth2.googleapis.com/token") || u.includes("/oauth/access_token")) {
      return tokenOk
        ? Response.json({ access_token: "provider-token" })
        : new Response("no", { status: 400 });
    }
    return profileOk ? Response.json(profile) : new Response("no", { status: 500 });
  });
  return calls;
}

describe("Rust oauth.rs unit tests", () => {
  // a_provider_needs_its_switch_and_both_credentials
  it("a provider needs its switch and both credentials", async () => {
    setCloudflareContext({ ...OAUTH_ENV, OAUTH_FACEBOOK_ENABLED: "false" });
    expect(await enabledProvider("google")).not.toBeNull();
    expect(await enabledProvider("facebook")).toBeNull(); // switched off
    setCloudflareContext({ ...OAUTH_ENV, OAUTH_GOOGLE_CLIENT_SECRET: "" });
    expect(await enabledProvider("google")).toBeNull(); // no secret
    expect(await enabledProvider("github")).toBeNull();
    setCloudflareContext({ ...OAUTH_ENV, OAUTH_GOOGLE_ENABLED: "1" }); // Rust parses a bool: only "true"
    expect(await enabledProvider("google")).toBeNull();
  });

  // google.rs / facebook.rs builds_authorization_url
  it("builds the authorization URLs", async () => {
    const g = (await enabledProvider("google"))!.authorizationUrl("xyz", "https://app.com/cb");
    expect(g).toContain("client_id=123");
    expect(g).toContain("state=xyz");
    expect(g).toContain("redirect_uri=https%3A%2F%2Fapp.com%2Fcb");
    expect(g).toContain("scope=openid%20email%20profile");
    expect(g).toContain("response_type=code&access_type=offline&prompt=consent");
    const f = (await enabledProvider("facebook"))!.authorizationUrl("xyz", "https://app.com/cb");
    expect(f.startsWith("https://www.facebook.com/v18.0/dialog/oauth?client_id=456")).toBe(true);
    expect(f).toContain("scope=email%20public_profile&response_type=code");
    expect(f).not.toContain("access_type");
  });

  it("honours OAUTH_<P>_SCOPES", async () => {
    setCloudflareContext({ ...OAUTH_ENV, OAUTH_GOOGLE_SCOPES: "openid email" });
    expect((await enabledProvider("google"))!.authorizationUrl("s", "https://x/cb")).toContain(
      "scope=openid%20email&",
    );
  });

  it("state tokens are 43 URL-safe characters; callback URLs drop a trailing slash", () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateState()).not.toBe(generateState());
    expect(callbackUrl("https://datxevui.com//", "google")).toBe(
      "https://datxevui.com/api/auth/oauth/google/callback",
    );
    expect(urlEncode("a b!'()*~-_.é")).toBe("a%20b%21%27%28%29%2A~-_.%C3%A9");
  });
});

describe("providers", () => {
  it("lists exactly the usable ones, google before facebook", async () => {
    expect(await (await providers()).json()).toEqual({ providers: ["google", "facebook"] });
    setCloudflareContext({ ...OAUTH_ENV, OAUTH_GOOGLE_ENABLED: "false" });
    expect(await (await providers()).json()).toEqual({ providers: ["facebook"] });
    setCloudflareContext();
    expect(await (await providers()).json()).toEqual({ providers: [] });
  });

  it("a client id alone (no switch) shows no button", async () => {
    setCloudflareContext({ OAUTH_GOOGLE_CLIENT_ID: "x", OAUTH_GOOGLE_CLIENT_SECRET: "y" });
    expect(await (await providers()).json()).toEqual({ providers: [] });
  });
});

describe("start", () => {
  it("redirects (307) to the provider with a state kept in a short-lived cookie", async () => {
    const { res, state } = await started("google", "http://localhost:3000");
    expect(res.status).toBe(307);
    const url = new URL(location(res));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://datxevui.com/api/auth/oauth/google/callback",
    );
    const cookie = setCookie(res, "oauth_state_google")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure"); // plain http → not secure, like COOKIE_SECURE=false
  });

  it("is Secure over https / COOKIE_SECURE=true", async () => {
    setCloudflareContext({ ...OAUTH_ENV, COOKIE_SECURE: "true" });
    expect(setCookie((await started()).res, "oauth_state_google")).toContain("Secure");
  });

  it("an unknown or disabled provider is 404; a missing redirect base is 500", async () => {
    const unknown = await start(get("/api/auth/oauth/github/start"), ctx("github"));
    expect([unknown.status, await unknown.json()]).toEqual([
      404,
      { error: "not_found", message: "resource not found: oauth provider 'github' not configured" },
    ]);
    setCloudflareContext({ ...OAUTH_ENV, OAUTH_REDIRECT_BASE_URL: "" });
    const noBase = await start(get("/api/auth/oauth/google/start"), ctx("google"));
    expect([noBase.status, await noBase.json()]).toEqual([
      500,
      { error: "internal_error", message: "internal server error" },
    ]);
  });
});

describe("callback errors redirect to the login page", () => {
  const callbackWith = async (query: string, cookie?: string, provider = "google") =>
    callback(
      get(`/api/auth/oauth/${provider}/callback?${query}`, cookie ? { cookie } : {}),
      ctx(provider),
    );
  const login = "https://app.datxevui.com/login?oauth_error=";

  it("provider-side refusals pass their description through", async () => {
    const res = await callbackWith("error=access_denied&error_description=User%20said%20no");
    expect([res.status, location(res)]).toEqual([307, `${login}User%20said%20no`]);
    expect(location(await callbackWith("error=access_denied"))).toBe(`${login}access_denied`);
  });

  it("needs a code, a state, a state cookie and the two to match", async () => {
    const { state } = await started();
    const cookie = `oauth_state_google=${state}`;
    expect(location(await callbackWith("state=s", cookie))).toBe(
      `${login}${urlEncode("Thiếu mã xác thực OAuth")}`,
    );
    expect(location(await callbackWith("code=c", cookie))).toBe(
      `${login}${urlEncode("Thiếu state token OAuth")}`,
    );
    expect(location(await callbackWith(`code=c&state=${state}`))).toBe(
      `${login}${urlEncode("Phiên OAuth hết hạn — vui lòng thử lại")}`,
    );
    const mismatch = await callbackWith("code=c&state=forged", cookie);
    expect(location(mismatch)).toBe(
      `${login}${urlEncode("State không khớp — có thể bị tấn công CSRF")}`,
    );
    expect(mismatch.headers.getSetCookie()).toEqual([]); // no session for a forged callback
  });

  it("a state cookie for another provider does not count", async () => {
    const { state } = await started("facebook");
    const res = await callbackWith(
      `code=c&state=${state}`,
      `oauth_state_facebook=${state}`,
      "google",
    );
    expect(location(res)).toContain(urlEncode("Phiên OAuth hết hạn"));
  });

  it("reports a failed token exchange, a failed profile fetch and a disabled provider", async () => {
    const { state } = await started();
    const cookie = `oauth_state_google=${state}`;
    stubProvider({}, false);
    expect(location(await callbackWith(`code=c&state=${state}`, cookie))).toBe(
      `${login}${urlEncode("Không thể đổi mã OAuth lấy token")}`,
    );
    stubProvider({}, true, false);
    expect(location(await callbackWith(`code=c&state=${state}`, cookie))).toBe(
      `${login}${urlEncode("Không thể lấy thông tin người dùng")}`,
    );
    setCloudflareContext({ ...OAUTH_ENV, OAUTH_GOOGLE_ENABLED: "false" });
    expect(location(await callbackWith(`code=c&state=${state}`, cookie))).toBe(
      `${login}${urlEncode("Nhà cung cấp OAuth không được cấu hình")}`,
    );
  });

  it("without OAUTH_FRONTEND_URL the redirects are relative", async () => {
    setCloudflareContext({ ...OAUTH_ENV, OAUTH_FRONTEND_URL: "" });
    expect(location(await callbackWith("error=nope"))).toBe("/login?oauth_error=nope");
  });

  it("refuses an unverified Google email (account-takeover guard)", async () => {
    const { state } = await started();
    stubProvider({ sub: "g-1", email: "victim@test.vn", email_verified: false, name: "X" });
    const res = await callbackWith(`code=c&state=${state}`, `oauth_state_google=${state}`);
    expect(location(res)).toContain(urlEncode("Không thể lấy thông tin người dùng"));
    expect(await (await getDb()).select().from(users)).toHaveLength(0);
  });

  it("a Facebook profile without an email cannot sign in", async () => {
    const { state } = await started("facebook");
    stubProvider({ id: "fb-1", name: "No Mail" });
    const res = await callbackWith(
      `code=c&state=${state}`,
      `oauth_state_facebook=${state}`,
      "facebook",
    );
    expect(location(res)).toContain(urlEncode("Không thể lấy thông tin người dùng"));
  });
});

describe("callback success", () => {
  async function signIn(profile: Record<string, unknown>, provider = "google") {
    const { state } = await started(provider);
    const calls = stubProvider(profile);
    const res = await callback(
      get(`/api/auth/oauth/${provider}/callback?code=the-code&state=${state}`, {
        cookie: `oauth_state_${provider}=${state}`,
      }),
      ctx(provider),
    );
    return { res, calls };
  }
  const google = {
    sub: "g-1",
    email: "an@test.vn",
    email_verified: true,
    name: "An",
    picture: "https://img/an.png",
  };

  it("creates a verified, password-less account, signs it in and clears the state", async () => {
    const { res, calls } = await signIn(google);
    expect([res.status, location(res)]).toEqual([307, "https://app.datxevui.com"]);
    expect(setCookie(res, "access_token")).toBeDefined();
    expect(setCookie(res, "refresh_token")).toContain("Max-Age=604800");
    expect(setCookie(res, "oauth_state_google")).toContain("Max-Age=0");

    const u = (await (await getDb()).select().from(users).where(eq(users.email, "an@test.vn")))[0]!;
    expect(u).toMatchObject({
      fullName: "An",
      role: "admin", // the first human
      passwordHash: null,
      oauthProvider: "google",
      oauthSubject: "g-1",
      avatarUrl: "https://img/an.png",
    });
    expect(u.emailVerifiedAt).not.toBeNull();
    // Code exchange: form POST with the secret; profile with a Bearer token.
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0]!.init!.body)).toContain("grant_type=authorization_code");
    expect(String(calls[0]!.init!.body)).toContain("client_secret=secret");
    expect(new Headers(calls[1]!.init!.headers).get("authorization")).toBe("Bearer provider-token");
  });

  it("the same identity signs in again; a second person is a plain user", async () => {
    await signIn(google);
    expect((await signIn(google)).res.status).toBe(307);
    expect(await (await getDb()).select().from(users)).toHaveLength(1);
    await signIn({ ...google, sub: "g-2", email: "binh@test.vn" });
    const binh = (
      await (await getDb()).select().from(users).where(eq(users.email, "binh@test.vn"))
    )[0]!;
    expect(binh.role).toBe("user");
  });

  it("links the identity to an existing password account with the same email", async () => {
    const { id } = await createUser({ email: "an@test.vn" });
    await signIn(google);
    const u = (await (await getDb()).select().from(users).where(eq(users.id, id)))[0]!;
    expect([u.oauthProvider, u.oauthSubject, u.avatarUrl]).toEqual([
      "google",
      "g-1",
      "https://img/an.png",
    ]);
    expect(u.passwordHash).not.toBeNull(); // still signs in with the password too
    expect(await (await getDb()).select().from(users)).toHaveLength(1);
    void PASSWORD;
  });

  it("Facebook: the token request carries the credentials in the query", async () => {
    const { res, calls } = await signIn(
      {
        id: "fb-1",
        name: "Binh",
        email: "binh@test.vn",
        picture: { data: { url: "https://img/b.png" } },
      },
      "facebook",
    );
    expect(res.status).toBe(307);
    expect(calls[0]!.init!.method).toBe("POST");
    expect(calls[0]!.url).toContain("https://graph.facebook.com/v18.0/oauth/access_token?");
    expect(calls[0]!.url).toContain("client_secret=fb-secret");
    expect(calls[1]!.url).toContain("fields=id%2Cname%2Cemail%2Cpicture");
    const u = (
      await (await getDb()).select().from(users).where(eq(users.email, "binh@test.vn"))
    )[0]!;
    expect([u.oauthProvider, u.avatarUrl]).toEqual(["facebook", "https://img/b.png"]);
  });
});
