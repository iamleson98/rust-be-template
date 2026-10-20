import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearTurnCache,
  fetchTurnIceServers,
  iceServersFor,
  PUBLIC_ICE_SERVERS,
  turnConfigured,
  TURN_FIREWALL_URLS,
  withFirewallFriendlyUrls,
} from "@/lib/services/turn-credentials";

/**
 * Cloudflare Calls TURN credential minting — the corporate-network
 * lifeline for /ws-call. The API is mocked; the module under test is the
 * real caching/fallback logic.
 */

const ENV = { TURN_KEY_ID: "key-123", TURN_KEY_API_TOKEN: "tok" };

function cfResponse(servers: unknown, ok = true) {
  return {
    ok,
    status: ok ? 201 : 500,
    json: async () => (ok ? { iceServers: servers } : { errors: [{ message: "boom" }] }),
  } as unknown as Response;
}

const TURN_SERVERS = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: [
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turn:turn.cloudflare.com:443?transport=udp",
      "turn:turn.cloudflare.com:3478?transport=tcp",
      "turn:turn.cloudflare.com:80?transport=tcp",
      "turns:turn.cloudflare.com:5349?transport=tcp",
      "turns:turn.cloudflare.com:443?transport=tcp",
    ],
    username: "u1",
    credential: "c1",
  },
];

beforeEach(() => {
  __clearTurnCache();
});

describe("turnConfigured", () => {
  it("requires both key id and token", () => {
    expect(turnConfigured(ENV)).toBe(true);
    expect(turnConfigured({ TURN_KEY_ID: "key-123" })).toBe(false);
    expect(turnConfigured({})).toBe(false);
  });
});

describe("fetchTurnIceServers", () => {
  it("mints credentials from the Cloudflare TURN API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(cfResponse(TURN_SERVERS));
    const servers = await fetchTurnIceServers(ENV, fetchImpl as unknown as typeof fetch);
    expect(servers).not.toBeNull();
    expect(servers!.length).toBe(2);
    expect(servers![1]!.username).toBe("u1");
    expect(servers![1]!.urls).toContain("turns:turn.cloudflare.com:443?transport=tcp");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-123/credentials/generate-ice-servers",
    );
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string).ttl).toBe(86400);
  });

  it("caches until half the TTL (one API call for many registrations)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(cfResponse(TURN_SERVERS));
    for (let i = 0; i < 5; i++) {
      await fetchTurnIceServers(ENV, fetchImpl as unknown as typeof fetch);
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("serves stale credentials when the API blips", async () => {
    const good = vi.fn().mockResolvedValue(cfResponse(TURN_SERVERS));
    await fetchTurnIceServers(ENV, good as unknown as typeof fetch);
    const bad = vi.fn().mockRejectedValue(new Error("network down"));
    const servers = await fetchTurnIceServers(
      { ...ENV, TURN_TTL_SECONDS: "600" },
      bad as unknown as typeof fetch,
      true,
    );
    expect(bad).toHaveBeenCalledOnce();
    expect(servers).not.toBeNull(); // stale cache served
    expect(servers![1]!.username).toBe("u1");
  });

  it("falls back to null (public STUN) when never fetched and the API fails", async () => {
    const bad = vi.fn().mockResolvedValue(cfResponse(null, false));
    const servers = await fetchTurnIceServers(ENV, bad as unknown as typeof fetch);
    expect(servers).toBeNull();
  });

  it("returns null when TURN is not configured", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchTurnIceServers({}, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("iceServersFor (what the hub hands clients)", () => {
  it("returns TURN + public STUN when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(cfResponse(TURN_SERVERS));
    const servers = await iceServersFor(ENV, fetchImpl as unknown as typeof fetch);
    expect(servers.length).toBe(2 + PUBLIC_ICE_SERVERS.length);
    expect(servers.some((s) => s.username)).toBe(true);
    expect(servers.some((s) => s.urls.includes("stun:stun.l.google.com:19302"))).toBe(true);
  });

  it("falls back to public STUN when TURN is not configured", async () => {
    const servers = await iceServersFor({}, vi.fn() as unknown as typeof fetch);
    expect(servers).toEqual(PUBLIC_ICE_SERVERS);
  });
});

describe("firewall-friendly relay URLs", () => {
  it("adds TCP 443/80 and TLS 443 when the API only returns the standard ports", async () => {
    const minimal = [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turn:turn.cloudflare.com:3478?transport=tcp",
          "turns:turn.cloudflare.com:5349?transport=tcp",
        ],
        username: "u1",
        credential: "c1",
      },
    ];
    const servers = await iceServersFor(ENV, vi.fn().mockResolvedValue(cfResponse(minimal)));
    const turn = servers.find((s) => s.username === "u1");
    expect(turn?.urls).toEqual(expect.arrayContaining(TURN_FIREWALL_URLS));
    expect(turn?.urls).toContain("turns:turn.cloudflare.com:443?transport=tcp");
    expect(turn?.urls).toContain("turn:turn.cloudflare.com:80?transport=tcp");
    // No duplicates, and the credential travels with the entry.
    expect(new Set(turn?.urls).size).toBe(turn?.urls.length);
    expect(turn?.credential).toBe("c1");
  });

  it("leaves STUN-only entries alone", () => {
    const stun = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
    expect(withFirewallFriendlyUrls(stun)).toEqual(stun);
  });
});
