import { beforeEach, describe, expect, it } from "vitest";
import { setCloudflareContext } from "../helpers/context";
import { sessionCookies, clearSessionCookies, cookiePolicy } from "@/lib/auth/session";

/** GET-style request the route handlers receive. */
const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers });

beforeEach(() => {
  setCloudflareContext(); // default: no COOKIE_SAMESITE → production-like
});

describe("cookiePolicy / sessionCookies", () => {
  it("production default over plain http: SameSite=Lax, no Secure", async () => {
    const [access] = await sessionCookies("at", "rt", req("http://localhost:3000/api/auth/login"));
    expect(access).toContain("SameSite=Lax");
    expect(access).not.toContain("Secure");
    expect(access).not.toContain("Partitioned");
    expect(access).toContain("HttpOnly");
    expect(access).toContain("Path=/");
    expect(access).toContain("Max-Age=900");
  });

  it("production default behind an https proxy (x-forwarded-proto): Lax + Secure", async () => {
    const [access] = await sessionCookies(
      "at",
      "rt",
      req("http://localhost:3000/api/auth/login", { "x-forwarded-proto": "https" }),
    );
    expect(access).toContain("SameSite=Lax");
    expect(access).toContain("Secure");
    expect(access).not.toContain("Partitioned");
  });

  it("https request URL directly: Lax + Secure", async () => {
    const [access] = await sessionCookies("at", "rt", req("https://datxevui.com/api/auth/login"));
    expect(access).toContain("SameSite=Lax");
    expect(access).toContain("Secure");
  });

  it("COOKIE_SAMESITE=none (embedded preview): SameSite=None; Secure; Partitioned", async () => {
    setCloudflareContext({ COOKIE_SAMESITE: "none" });
    // even over internal http — the public origin is https behind the proxy
    const [access, refresh] = await sessionCookies("at", "rt", req("http://localhost:3000/api/auth/login"));
    expect(access).toContain("SameSite=None");
    expect(access).toContain("Secure");
    expect(access).toContain("Partitioned");
    expect(access).toContain("HttpOnly");
    expect(refresh).toContain("SameSite=None");
    expect(refresh).toContain("Max-Age=604800");
  });

  it("cookiePolicy() reflects the tiers", async () => {
    expect(await cookiePolicy(req("http://x/"))).toEqual({
      secure: false,
      sameSite: "Lax",
      partitioned: false,
    });
    setCloudflareContext({ COOKIE_SAMESITE: "none" });
    expect(await cookiePolicy(req("http://x/"))).toEqual({
      secure: true,
      sameSite: "None",
      partitioned: true,
    });
  });
});

describe("clearSessionCookies", () => {
  it("expires both cookies with the production policy", async () => {
    const [access, refresh] = await clearSessionCookies(req("http://localhost:3000/api/auth/logout"));
    expect(access).toMatch(/^access_token=; /);
    expect(access).toContain("Max-Age=0");
    expect(refresh).toMatch(/^refresh_token=; /);
    expect(refresh).toContain("SameSite=Lax");
  });

  it("expires both cookies with the preview (CHIPS) policy", async () => {
    setCloudflareContext({ COOKIE_SAMESITE: "none" });
    const [access] = await clearSessionCookies(req("http://localhost:3000/api/auth/logout"));
    expect(access).toContain("SameSite=None");
    expect(access).toContain("Secure");
    expect(access).toContain("Partitioned");
    expect(access).toContain("Max-Age=0");
  });
});
