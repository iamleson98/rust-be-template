import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { setCloudflareContext } from "../helpers/context";
import { migrate, owner } from "../helpers/fixture";
import { GET as onlineChannels } from "../../src/app/api/chat/channels/online/route";
import { GET as nullclawExchanges } from "../../src/app/api/nullclaw/exchanges/route";
import { GET as nullclawStatus } from "../../src/app/api/nullclaw/status/route";
import { GET as staffPresence } from "../../src/app/api/presence/staff/route";

/**
 * Rust guards these three reads (`routes/chat.rs`, `routes/presence.rs`,
 * `routes/nullclaw.rs`): they list customer ids, staff rosters and AI
 * transcripts that carry customers' PII. They must never answer an anonymous
 * or customer request.
 */
beforeAll(migrate);
beforeEach(() => setCloudflareContext());

async function employee(): Promise<string> {
  const id = crypto.randomUUID();
  await (await getDb()).insert(users).values({
    id,
    fullName: "Support Agent",
    email: `agent-${id}@test.vn`,
    role: "employee",
    status: "active",
    locale: "vi",
  });
  return id;
}

async function get(path: string, userId: string | null): Promise<Request> {
  const headers: Record<string, string> = {};
  if (userId) headers.authorization = `Bearer ${await signAccessToken(userId)}`;
  return new Request(`https://datxevui.com${path}`, { headers });
}

const staffOnly = [
  ["/api/chat/channels/online", onlineChannels],
  ["/api/presence/staff", staffPresence],
] as const;

describe.each(staffOnly)("GET %s", (path, route) => {
  it("rejects anonymous callers with 401", async () => {
    expect((await route(await get(path, null))).status).toBe(401);
  });

  it("rejects customers with 403", async () => {
    expect((await route(await get(path, await owner()))).status).toBe(403);
  });

  it("answers staff", async () => {
    expect((await route(await get(path, await employee()))).status).toBe(200);
  });
});

describe("GET /api/nullclaw/exchanges", () => {
  const path = "/api/nullclaw/exchanges";

  it("rejects anonymous callers with 401", async () => {
    expect((await nullclawExchanges(await get(path, null))).status).toBe(401);
  });

  it("rejects customers with 403", async () => {
    expect((await nullclawExchanges(await get(path, await owner()))).status).toBe(403);
  });

  it("rejects employees: the audit log is admin-only (admin:nullclaw:read)", async () => {
    expect((await nullclawExchanges(await get(path, await employee()))).status).toBe(403);
  });

  it("answers admins", async () => {
    const res = await nullclawExchanges(await get(path, await owner("admin")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});

describe("GET /api/nullclaw/status", () => {
  it("stays public, like Rust (it only reports whether the assistant is on)", async () => {
    expect((await nullclawStatus()).status).toBe(200);
  });
});
