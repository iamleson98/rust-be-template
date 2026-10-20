import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import { setCloudflareContext, BASE_TEST_ENV } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { signAccessToken } from "@/lib/auth/jwt";
import { authenticateWs, originAllowed } from "@/lib/realtime/ws-auth";

/** The credential + Origin rules both socket hubs enforce on upgrade. */
const AUTH_ENV = { JWT_SECRET: String(BASE_TEST_ENV.JWT_SECRET), DB: env.DB };
const IDS = {
  customer: crypto.randomUUID(),
  staff: crypto.randomUUID(),
  blocked: crypto.randomUUID(),
};
const TOKENS: Record<string, string> = {};

const upgrade = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://app.example${path}`, { headers: { upgrade: "websocket", ...headers } });

beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0);
  const db = await getDb();
  await db.insert(users).values([
    {
      id: IDS.customer,
      fullName: "Cust",
      email: "c@t.vn",
      role: "user",
      status: "active",
      locale: "vi",
    },
    {
      id: IDS.staff,
      fullName: "Staff",
      email: "s@t.vn",
      role: "employee",
      status: "active",
      locale: "vi",
    },
    {
      id: IDS.blocked,
      fullName: "Blocked",
      email: "b@t.vn",
      role: "user",
      status: "blocked",
      locale: "vi",
    },
  ]);
  for (const [k, id] of Object.entries(IDS)) TOKENS[k] = await signAccessToken(id);
});

describe("authenticateWs", () => {
  it("accepts a token in the query string, a Bearer header, or the cookie", async () => {
    const q = await authenticateWs(upgrade(`/ws-call?token=${TOKENS.customer}`), AUTH_ENV);
    const h = await authenticateWs(
      upgrade("/ws-call", { authorization: `Bearer ${TOKENS.customer}` }),
      AUTH_ENV,
    );
    const c = await authenticateWs(
      upgrade("/ws-call", { cookie: `x=1; access_token=${TOKENS.customer}` }),
      AUTH_ENV,
    );
    for (const r of [q, h, c]) {
      expect(r.ok && r.user.id).toBe(IDS.customer);
    }
    expect(q.ok && q.viaToken).toBe(true);
    expect(c.ok && c.viaToken).toBe(false);
  });

  it("knows who is staff from the database, not from the client", async () => {
    const s = await authenticateWs(upgrade(`/ws-call?token=${TOKENS.staff}`), AUTH_ENV);
    const c = await authenticateWs(upgrade(`/ws-call?token=${TOKENS.customer}`), AUTH_ENV);
    expect(s.ok && s.user.isStaff).toBe(true);
    expect(c.ok && c.user.isStaff).toBe(false);
  });

  it("rejects missing, malformed and non-active credentials", async () => {
    expect(await authenticateWs(upgrade("/ws-call"), AUTH_ENV)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await authenticateWs(upgrade("/ws-call?token=junk"), AUTH_ENV)).toMatchObject({
      ok: false,
    });
    expect(
      await authenticateWs(upgrade(`/ws-call?token=${TOKENS.blocked}`), AUTH_ENV),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("Origin-checks cookie auth (cross-site WebSocket hijacking) but not token auth", async () => {
    const cookie = `access_token=${TOKENS.customer}`;
    const evil = await authenticateWs(
      upgrade("/ws-call", { cookie, origin: "https://evil.example" }),
      AUTH_ENV,
    );
    expect(evil).toMatchObject({ ok: false, status: 403 });
    const same = await authenticateWs(
      upgrade("/ws-call", { cookie, origin: "https://app.example" }),
      AUTH_ENV,
    );
    expect(same.ok).toBe(true);
    const mobile = await authenticateWs(
      upgrade(`/ws-call?token=${TOKENS.customer}`, { origin: "https://evil.example" }),
      AUTH_ENV,
    );
    expect(mobile.ok).toBe(true);
    // No Origin at all = a non-browser client.
    expect((await authenticateWs(upgrade("/ws-call", { cookie }), AUTH_ENV)).ok).toBe(true);
  });
});

describe("originAllowed", () => {
  const url = new URL("https://app.example/ws");
  it("matches the request host and any configured extras", () => {
    expect(originAllowed("https://app.example", url, undefined)).toBe(true);
    expect(
      originAllowed("https://www.example", url, "https://www.example, https://m.example"),
    ).toBe(true);
    expect(originAllowed("https://m.example", url, "https://www.example, https://m.example")).toBe(
      true,
    );
    expect(originAllowed("https://evil.example", url, "https://www.example")).toBe(false);
    expect(originAllowed("not a url", url, undefined)).toBe(false);
  });
});
