import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import { setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { __clearFcmCache } from "@/lib/push/fcm";
import { __clearApnsCache, voipTopic } from "@/lib/push/apns";
import { deleteDeviceForUser, listDevices, upsertDevice } from "@/lib/push/devices";
import {
  callKitPayload,
  notifyCallEnded,
  notifyIncomingCall,
  pushEnabled,
} from "@/lib/push/notify";

/**
 * Device push for incoming calls. The provider endpoints are mocked; the keys
 * are REAL (generated here), so the RS256 / ES256 JWT signing — the part most
 * likely to be wrong — actually runs.
 */
const AGENT = crypto.randomUUID();
const OTHER = crypto.randomUUID();

function pem(label: string, der: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----`;
}

let FCM_JSON = "";
let APNS_PEM = "";

beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0);
  const db = await getDb();
  await db.insert(users).values([
    {
      id: AGENT,
      fullName: "Agent",
      email: "a@t.vn",
      role: "employee",
      status: "active",
      locale: "vi",
    },
    {
      id: OTHER,
      fullName: "Other",
      email: "o@t.vn",
      role: "employee",
      status: "active",
      locale: "vi",
    },
  ]);
  const rsa = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  FCM_JSON = JSON.stringify({
    project_id: "proj-1",
    client_email: "svc@proj-1.iam.gserviceaccount.com",
    private_key: pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", rsa.privateKey)),
  });
  const ec = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  APNS_PEM = pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", ec.privateKey));
});

beforeEach(async () => {
  __clearFcmCache();
  __clearApnsCache();
  await env.DB.prepare("DELETE FROM push_device").run();
});

const CALL = { customerId: "cust-1", channelId: "ch-1", callerName: "Khách A", callerAvatar: null };

function pushEnv(extra: Record<string, string> = {}) {
  return { DB: env.DB, AUDIO_CALL_RING_TIMEOUT_SECS: "60", ...extra };
}

/** A fetch that records calls and answers each provider like the real one. */
function mockFetch(opts: { fcmStatus?: number; apnsStatus?: number } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com")) {
      return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (u.includes("fcm.googleapis.com"))
      return new Response("{}", { status: opts.fcmStatus ?? 200 });
    if (u.includes("push.apple.com")) return new Response("", { status: opts.apnsStatus ?? 200 });
    throw new Error(`unexpected fetch ${u} ${init?.method}`);
  });
}

describe("device registry", () => {
  it("is idempotent per (user, token) and removable only by its owner", async () => {
    await upsertDevice(env.DB, AGENT, "tok-1", "android");
    await upsertDevice(env.DB, AGENT, "tok-1", "android");
    expect(await listDevices(env.DB, AGENT)).toEqual([{ token: "tok-1", platform: "android" }]);
    expect(await deleteDeviceForUser(env.DB, OTHER, "tok-1")).toBe(0); // not theirs
    expect(await deleteDeviceForUser(env.DB, AGENT, "tok-1")).toBe(1);
    expect(await listDevices(env.DB, AGENT)).toEqual([]);
  });
});

describe("payloads", () => {
  it("builds the CallKit-ready iOS payload the app's PushKit handler expects", () => {
    const p = callKitPayload({ ...CALL, callerAvatar: "https://x/a.png" }, 60_000);
    expect(p).toMatchObject({
      id: "call-cust-1",
      nameCaller: "Khách A",
      handle: "cust-1",
      type: 0,
      duration: 60_000,
      avatar: "https://x/a.png",
      extra: { type: "incoming-call", customerId: "cust-1", channelId: "ch-1" },
    });
    expect(callKitPayload({ ...CALL, callerName: null }, 1).nameCaller).toBe("Khách hàng");
  });

  it("addresses VoIP pushes to <bundle>.voip", () => {
    expect(voipTopic("com.datxevui.agent")).toBe("com.datxevui.agent.voip");
    expect(voipTopic("com.datxevui.agent.voip")).toBe("com.datxevui.agent.voip");
  });
});

describe("notifyIncomingCall", () => {
  it("is a no-op without credentials", async () => {
    await upsertDevice(env.DB, AGENT, "tok", "android");
    const f = mockFetch();
    expect(pushEnabled(pushEnv())).toBe(false);
    await notifyIncomingCall(pushEnv(), AGENT, CALL, f);
    expect(f).not.toHaveBeenCalled();
  });

  it("sends Android devices a high-priority FCM data message (string values only)", async () => {
    await upsertDevice(env.DB, AGENT, "android-tok", "android");
    const f = mockFetch();
    await notifyIncomingCall(pushEnv({ FCM_CREDENTIALS_JSON: FCM_JSON }), AGENT, CALL, f);

    const send = f.mock.calls.find(([u]) => String(u).includes("fcm.googleapis.com"))!;
    expect(String(send[0])).toContain("/projects/proj-1/messages:send");
    expect((send[1]!.headers as Record<string, string>).authorization).toBe("Bearer ya29.test");
    const body = JSON.parse(String(send[1]!.body));
    expect(body.message.token).toBe("android-tok");
    expect(body.message.android).toMatchObject({ priority: "HIGH", collapse_key: "call-cust-1" });
    expect(body.message.android.data).toEqual({
      type: "incoming-call",
      customerId: "cust-1",
      channelId: "ch-1",
      callerName: "Khách A",
    }); // callerAvatar was null: dropped, because FCM data values must be strings
    // The token exchange was a real RS256 assertion.
    const exchange = f.mock.calls.find(([u]) => String(u).includes("oauth2"))!;
    const assertion = new URLSearchParams(String(exchange[1]!.body)).get("assertion")!;
    expect(assertion.split(".")).toHaveLength(3);
    expect(
      JSON.parse(atob(assertion.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))),
    ).toMatchObject({
      alg: "RS256",
    });
  });

  it("sends iOS devices an APNs VoIP push with a short delivery window", async () => {
    await upsertDevice(env.DB, AGENT, "ios-tok", "ios");
    const f = mockFetch();
    await notifyIncomingCall(
      pushEnv({
        APNS_KEY_PEM: APNS_PEM,
        APNS_KEY_ID: "KEY1234567",
        APNS_TEAM_ID: "TEAM123456",
        APNS_TOPIC: "com.datxevui.agent",
      }),
      AGENT,
      CALL,
      f,
    );
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://api.push.apple.com/3/device/ios-tok");
    const h = init!.headers as Record<string, string>;
    expect(h["apns-push-type"]).toBe("voip");
    expect(h["apns-topic"]).toBe("com.datxevui.agent.voip");
    expect(h["apns-priority"]).toBe("10");
    expect(h["apns-collapse-id"]).toBe("call-cust-1");
    const ttl = Number(h["apns-expiration"]) - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(80);
    expect(ttl).toBeLessThanOrEqual(90);
    const jwt = h.authorization.replace(/^bearer /, "");
    const header = JSON.parse(atob(jwt.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    expect(header).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(String(init!.body)).nameCaller).toBe("Khách A");
  });

  it("routes each device to its own transport and prunes tokens the provider says are gone", async () => {
    await upsertDevice(env.DB, AGENT, "dead-android", "android");
    await upsertDevice(env.DB, AGENT, "live-ios", "ios");
    const f = mockFetch({ fcmStatus: 404 });
    await notifyIncomingCall(
      pushEnv({
        FCM_CREDENTIALS_JSON: FCM_JSON,
        APNS_KEY_PEM: APNS_PEM,
        APNS_KEY_ID: "KEY1234567",
        APNS_TEAM_ID: "TEAM123456",
        APNS_TOPIC: "com.datxevui.agent",
      }),
      AGENT,
      CALL,
      f,
    );
    expect((await listDevices(env.DB, AGENT)).map((d) => d.token)).toEqual(["live-ios"]);
  });

  it("keeps tokens on transient failures", async () => {
    await upsertDevice(env.DB, AGENT, "tok", "android");
    await notifyIncomingCall(
      pushEnv({ FCM_CREDENTIALS_JSON: FCM_JSON }),
      AGENT,
      CALL,
      mockFetch({ fcmStatus: 503 }),
    );
    expect(await listDevices(env.DB, AGENT)).toHaveLength(1);
  });
});

describe("notifyCallEnded", () => {
  it("goes to Android only: an iOS VoIP push must be reported to CallKit, so it never carries a non-ring", async () => {
    await upsertDevice(env.DB, AGENT, "android-tok", "android");
    await upsertDevice(env.DB, AGENT, "ios-tok", "ios");
    const f = mockFetch();
    await notifyCallEnded(
      pushEnv({
        FCM_CREDENTIALS_JSON: FCM_JSON,
        APNS_KEY_PEM: APNS_PEM,
        APNS_KEY_ID: "KEY1234567",
        APNS_TEAM_ID: "TEAM123456",
        APNS_TOPIC: "com.datxevui.agent",
      }),
      AGENT,
      "cust-1",
      f,
    );
    const urls = f.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("fcm.googleapis.com"))).toBe(true);
    expect(urls.some((u) => u.includes("push.apple.com"))).toBe(false);
  });
});
