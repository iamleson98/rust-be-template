import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobRuns } from "@/lib/db/schema";
import { handleTickRequest, runScheduledCron, sourceAllowed } from "@/lib/cron";
import { DRIVER_JOB, DRIVER_STALE_MS, externalDriverActive } from "@/lib/services/jobs";
import { setCloudflareContext } from "../helpers/context";
import { migrate } from "../helpers/fixture";

/**
 * The VPS service drives the jobs through `POST /api/jobs/tick`; the
 * Worker's Cron Trigger stands down while it does and takes over when it
 * stops.
 */

const TOKEN = "cron-token-0123456789";
const tickRequest = (token?: string, method = "POST", ip = "15.235.247.54") =>
  new Request("https://datxevui.com/api/jobs/tick", {
    method,
    headers: { "cf-connecting-ip": ip, ...(token ? { "x-cron-token": token } : {}) },
  });

async function driverRows(): Promise<number> {
  const db = await getDb();
  return (await db.select().from(jobRuns).where(eq(jobRuns.jobType, DRIVER_JOB))).length;
}

beforeAll(migrate);
beforeEach(async () => {
  setCloudflareContext({ CRON_SERVICE_TOKEN: TOKEN });
  await (await getDb()).delete(jobRuns);
});

describe("POST /api/jobs/tick", () => {
  it("refuses a missing or wrong token and other methods", async () => {
    expect((await handleTickRequest(tickRequest())).status).toBe(401);
    expect((await handleTickRequest(tickRequest("wrong"))).status).toBe(401);
    expect((await handleTickRequest(tickRequest(TOKEN, "GET"))).status).toBe(405);
    expect(await driverRows()).toBe(0);
  });

  it("runs the jobs and leaves one driver heartbeat per interval", async () => {
    const first = await handleTickRequest(tickRequest(TOKEN));
    expect(first.status).toBe(200);
    const body = (await first.json()) as { ok: boolean; ran: Array<{ jobType: string }> };
    expect(body.ok).toBe(true);
    expect(body.ran.map((r) => r.jobType)).toContain("holds.sweep");

    await handleTickRequest(tickRequest(TOKEN));
    await handleTickRequest(tickRequest(TOKEN));
    expect(await driverRows()).toBe(1);
    expect(await externalDriverActive()).toBe(true);
  });
});

describe("cron source allowlist", () => {
  it("accepts only the listed addresses, and any when none are listed", () => {
    const list = "15.235.247.54, 2402:1f00:8000:800::3dbe";
    expect(sourceAllowed("15.235.247.54", list)).toBe(true);
    expect(sourceAllowed("2402:1F00:8000:800::3DBE", list)).toBe(true);
    expect(sourceAllowed("203.0.113.9", list)).toBe(false);
    expect(sourceAllowed(null, list)).toBe(false);
    expect(sourceAllowed("203.0.113.9", undefined)).toBe(true);
  });

  it("refuses a valid token from another address before running anything", async () => {
    setCloudflareContext({ CRON_SERVICE_TOKEN: TOKEN, CRON_ALLOWED_IPS: "15.235.247.54" });
    expect((await handleTickRequest(tickRequest(TOKEN, "POST", "203.0.113.9"))).status).toBe(403);
    expect((await handleTickRequest(tickRequest(TOKEN))).status).toBe(200);
  });
});

describe("the Worker's Cron Trigger", () => {
  it("stands down while the VPS is ticking", async () => {
    await handleTickRequest(tickRequest(TOKEN));
    expect(await runScheduledCron()).toMatch(/^skipped/);
  });

  it("takes over when the VPS heartbeat is stale", async () => {
    const db = await getDb();
    const stale = new Date(Date.now() - DRIVER_STALE_MS - 60_000).toISOString();
    await db.insert(jobRuns).values({
      id: crypto.randomUUID(),
      jobType: DRIVER_JOB,
      status: "succeeded",
      startedAt: stale,
      finishedAt: stale,
      createdAt: stale,
    });
    expect(await externalDriverActive()).toBe(false);
    expect(await runScheduledCron()).toMatch(/^fallback tick: .*holds\.sweep=succeeded/);
  });
});
