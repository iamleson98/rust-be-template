import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { bearer, createUser, json, jsonRequest, migrateAuth, resetAccounts } from "../helpers/auth";
import { setCloudflareContext } from "../helpers/context";
import { GET as list } from "@/app/api/notifications/route";
import { POST as markRead } from "@/app/api/notifications/read/route";
import { POST as register } from "@/app/api/push/devices/route";
import { DELETE as unregister } from "@/app/api/push/devices/[token]/route";

/**
 * Notifications (`notification_service.rs`, `store/notification.rs`) and push
 * device registration (`routes/push_devices.rs`, `store/push_device.rs`).
 */
beforeAll(migrateAuth);
beforeEach(async () => {
  await resetAccounts();
  setCloudflareContext();
});

const as = async (id: string, method: string, path: string, body?: unknown) =>
  jsonRequest(path, { method, body, headers: await bearer(id) });

async function notify(userId: string, n: number, read = false) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    await env.DB.prepare(
      `INSERT INTO notification (id, user_id, type, title, body, data, read, created_at) VALUES (?, ?, 'booking_confirmed', ?, 'b', '{"id":1}', ?, ?)`,
    )
      .bind(
        id,
        userId,
        `n${i}`,
        read ? 1 : 0,
        `2026-03-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      )
      .run();
  }
  return ids;
}

describe("GET /api/notifications", () => {
  it("lists the caller's own, newest first, with total / unreadCount / limit / offset", async () => {
    const me = await createUser();
    const other = await createUser();
    await notify(me.id, 5);
    await notify(me.id, 2, true);
    await notify(other.id, 9);

    const res = await list(await as(me.id, "GET", "/api/notifications?limit=3&offset=1"));
    const page = await json(res);
    expect(page).toMatchObject({ total: 7, unreadCount: 5, limit: 3, offset: 1 });
    expect(page.items).toHaveLength(3);
    expect(page.items[0]).toEqual({
      id: expect.any(String),
      userId: me.id,
      type: "booking_confirmed",
      title: expect.any(String),
      body: "b",
      data: '{"id":1}',
      read: expect.any(Boolean),
      createdAt: expect.any(String),
    });
    const stamps = page.items.map((n: { createdAt: string }) => n.createdAt);
    expect(stamps).toEqual([...stamps].sort().reverse());
  });

  it("defaults to 20 and clamps the limit to 1..200", async () => {
    const me = await createUser();
    await notify(me.id, 25);
    expect(
      (await json(await list(await as(me.id, "GET", "/api/notifications")))).items,
    ).toHaveLength(20);
    const zero = await json(await list(await as(me.id, "GET", "/api/notifications?limit=0")));
    expect([zero.limit, zero.items.length]).toEqual([1, 1]);
    const huge = await json(await list(await as(me.id, "GET", "/api/notifications?limit=9999")));
    expect([huge.limit, huge.items.length]).toEqual([200, 25]);
  });

  it("401 without a token; 400 for a malformed paging value", async () => {
    expect((await list(jsonRequest("/api/notifications", { method: "GET" }))).status).toBe(401);
    const me = await createUser();
    expect((await list(await as(me.id, "GET", "/api/notifications?limit=x"))).status).toBe(400);
  });
});

describe("POST /api/notifications/read", () => {
  it("marks only the named ids, only the caller's, and counts rows actually changed", async () => {
    const me = await createUser();
    const other = await createUser();
    const mine = await notify(me.id, 3);
    const theirs = await notify(other.id, 1);
    const res = await markRead(
      await as(me.id, "POST", "/api/notifications/read", { ids: [mine[0], mine[1], theirs[0]] }),
    );
    expect(await json(res)).toEqual({ ok: true, updated: 2 });
    expect((await json(await list(await as(me.id, "GET", "/api/notifications")))).unreadCount).toBe(
      1,
    );
    expect(
      (await json(await list(await as(other.id, "GET", "/api/notifications")))).unreadCount,
    ).toBe(1);
    // Already read → nothing to update.
    const again = await markRead(
      await as(me.id, "POST", "/api/notifications/read", { ids: [mine[0]] }),
    );
    expect((await json(again)).updated).toBe(0);
  });

  it("an empty list, no list or no body marks everything unread of the caller", async () => {
    const me = await createUser();
    const other = await createUser();
    await notify(me.id, 4);
    await notify(other.id, 1);
    for (const body of [{ ids: [] }, {}, undefined]) {
      await notify(me.id, 1);
      const res = await markRead(await as(me.id, "POST", "/api/notifications/read", body));
      expect(res.status).toBe(200);
      expect((await json(res)).updated).toBeGreaterThan(0);
      expect(
        (await json(await list(await as(me.id, "GET", "/api/notifications")))).unreadCount,
      ).toBe(0);
    }
    expect(
      (await json(await list(await as(other.id, "GET", "/api/notifications")))).unreadCount,
    ).toBe(1);
  });

  it("handles more ids than one D1 statement can bind", async () => {
    const me = await createUser();
    const ids = await notify(me.id, 3);
    const padded = [...ids, ...Array.from({ length: 300 }, () => crypto.randomUUID())];
    expect(
      (
        await json(
          await markRead(await as(me.id, "POST", "/api/notifications/read", { ids: padded })),
        )
      ).updated,
    ).toBe(3);
  });

  it("rejects what is not a list of UUIDs, and malformed JSON, instead of marking everything", async () => {
    const me = await createUser();
    await notify(me.id, 2);
    for (const body of [{ ids: ["nope"] }, { ids: "all" }, { ids: [1] }]) {
      expect(
        (await markRead(await as(me.id, "POST", "/api/notifications/read", body))).status,
      ).toBe(400);
    }
    const broken = await markRead(
      new Request("https://datxevui.com/api/notifications/read", {
        method: "POST",
        headers: { ...(await bearer(me.id)), "content-type": "application/json" },
        body: "{oops",
      }),
    );
    expect(broken.status).toBe(400);
    expect((await json(await list(await as(me.id, "GET", "/api/notifications")))).unreadCount).toBe(
      2,
    );
    const tooMany = Array.from({ length: 501 }, () => crypto.randomUUID());
    expect(
      (await markRead(await as(me.id, "POST", "/api/notifications/read", { ids: tooMany }))).status,
    ).toBe(400);
  });

  it("401 without a token", async () => {
    expect((await markRead(jsonRequest("/api/notifications/read", { body: {} }))).status).toBe(401);
  });
});

interface PushRow {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

describe("push devices", () => {
  const devices = async () =>
    (await env.DB.prepare(`SELECT * FROM push_device ORDER BY created_at`).all<PushRow>()).results;

  it("registers a token, normalising the platform (ios | web | else android)", async () => {
    const me = await createUser();
    for (const [platform, stored] of [
      [" IOS ", "ios"],
      ["Web", "web"],
      ["blackberry", "android"],
      [undefined, "android"],
    ] as const) {
      const res = await register(
        await as(me.id, "POST", "/api/push/devices", {
          token: `tok-${stored}-${platform}`,
          platform,
        }),
      );
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true, pushEnabled: false });
      expect((await devices()).at(-1)!.platform).toBe(stored);
    }
  });

  it("is idempotent: re-registering refreshes only platform and updated_at", async () => {
    const me = await createUser();
    await register(
      await as(me.id, "POST", "/api/push/devices", { token: "tok", platform: "android" }),
    );
    const first = (await devices())[0]!;
    expect(first.last_seen_at).toBeNull(); // only a heartbeat sets it, as in Rust
    await register(
      await as(me.id, "POST", "/api/push/devices", { token: " tok ", platform: "ios" }),
    );
    const rows = await devices();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, platform: "ios", created_at: first.created_at });
    expect(rows[0]!.updated_at >= first.updated_at).toBe(true);
    expect(rows[0]!.last_seen_at).toBeNull();
  });

  it("rejects an empty or oversized token", async () => {
    const me = await createUser();
    const empty = await register(await as(me.id, "POST", "/api/push/devices", { token: "   " }));
    expect([empty.status, await json(empty)]).toEqual([
      400,
      { error: "bad_request", message: "bad request: token cannot be empty" },
    ]);
    const long = await register(
      await as(me.id, "POST", "/api/push/devices", { token: "t".repeat(4097) }),
    );
    expect([long.status, (await json(long)).message]).toEqual([
      400,
      "store error: validation error: invalid push token",
    ]);
    expect(
      (await register(await as(me.id, "POST", "/api/push/devices", { token: "t".repeat(4096) })))
        .status,
    ).toBe(200);
  });

  it("reports pushEnabled once FCM credentials exist", async () => {
    setCloudflareContext({ FCM_CREDENTIALS_JSON: "{}" });
    const me = await createUser();
    const res = await register(await as(me.id, "POST", "/api/push/devices", { token: "x" }));
    expect(typeof (await json(res)).pushEnabled).toBe("boolean");
  });

  it("any signed-in user registers; anonymous callers get 401", async () => {
    expect(
      (await register(jsonRequest("/api/push/devices", { body: { token: "x" } }))).status,
    ).toBe(401);
  });

  it("DELETE removes only the caller's own token — another user's is untouched", async () => {
    const a = await createUser();
    const b = await createUser();
    await register(await as(a.id, "POST", "/api/push/devices", { token: "shared" }));
    await register(await as(b.id, "POST", "/api/push/devices", { token: "shared" }));
    const del = (id: string, token: string) =>
      as(id, "DELETE", `/api/push/devices/${token}`).then((r) =>
        unregister(r, { params: Promise.resolve({ token }) }),
      );

    expect(await json(await del(a.id, "shared"))).toEqual({ ok: true, deleted: 1 });
    expect(await json(await del(a.id, "shared"))).toEqual({ ok: true, deleted: 0 });
    expect((await devices()).map((d) => d.user_id)).toEqual([b.id]);
    const victim = await register(await as(a.id, "POST", "/api/push/devices", { token: "only-a" }));
    expect(victim.status).toBe(200);
    expect(await json(await del(b.id, "only-a"))).toEqual({ ok: true, deleted: 0 });
    expect((await devices()).map((d) => d.token).sort()).toEqual(["only-a", "shared"]);
  });

  it("a token with a stray % in its path does not crash the route", async () => {
    const me = await createUser();
    const res = await unregister(await as(me.id, "DELETE", "/api/push/devices/x"), {
      params: Promise.resolve({ token: "100%real" }),
    });
    expect(res.status).toBe(200);
  });
});
