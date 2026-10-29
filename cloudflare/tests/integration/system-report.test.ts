import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { jobRuns } from "@/lib/db/schema";
import { systemReport } from "@/lib/services/system-status";
import { DRIVER_JOB } from "@/lib/services/jobs";
import { resetVpsBreaker } from "@/lib/vps";
import { setCloudflareContext } from "../helpers/context";
import { migrate } from "../helpers/fixture";

/**
 * `GET /api/admin/system` reports what is measured and nothing else: D1 is
 * probed for real, the cron driver is read from the job_run heartbeats, and
 * the VPS section is the service's own `/v1/status` (or why it is missing).
 */

const VPS = { VPS_URL: "https://vps.example.test", VPS_SERVICE_TOKEN: "t0ken" };
const STATUS = {
  service: { version: "0.1.0", startedAt: "t", uptimeSecs: 60, timezone: "Asia/Ho_Chi_Minh" },
  system: { cpus: 2, cpuPercent: 3.5, processCpuPercent: 0.4, loadAverage: [0.1, 0.1, 0.1] },
  requests: {},
  index: { state: "ready", places: 325_721 },
  jobs: [],
};

beforeAll(migrate);
beforeEach(async () => {
  resetVpsBreaker();
  await (await getDb()).delete(jobRuns);
});
afterEach(() => vi.unstubAllGlobals());

async function heartbeat(jobType: string, ageMs: number) {
  const at = new Date(Date.now() - ageMs).toISOString();
  await (await getDb()).insert(jobRuns).values({
    id: crypto.randomUUID(),
    jobType,
    status: "succeeded",
    startedAt: at,
    finishedAt: at,
    createdAt: at,
  });
}

describe("systemReport", () => {
  it("probes D1 and says the VPS is not configured, without inventing numbers", async () => {
    setCloudflareContext();
    const report = await systemReport();
    expect(report.database.reachable).toBe(true);
    expect(report.database.tables).toBeGreaterThan(10);
    expect(report.vps).toEqual({
      configured: false,
      reachable: false,
      latencyMs: null,
      error: null,
      status: null,
    });
    expect(report.placeSearch.engine).toBe("static-shards");
    expect(report.cron.driver).toBe("stopped");
  });

  it("includes the VPS status and names the live cron driver", async () => {
    setCloudflareContext(VPS);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json(STATUS);
    });
    await heartbeat(DRIVER_JOB, 60_000);
    const report = await systemReport();
    expect(calls).toEqual(["https://vps.example.test/v1/status"]);
    expect(report.vps.reachable).toBe(true);
    expect(report.vps.status?.index.places).toBe(325_721);
    expect(report.placeSearch.engine).toBe("vps");
    expect(report.cron.driver).toBe("vps");
  });

  it("reports an unreachable VPS and the Worker's fallback trigger", async () => {
    setCloudflareContext(VPS);
    vi.stubGlobal("fetch", async () => new Response("bad gateway", { status: 502 }));
    await heartbeat(DRIVER_JOB, 60 * 60_000);
    await heartbeat("holds.sweep", 60_000);
    const report = await systemReport();
    expect(report.vps).toMatchObject({ configured: true, reachable: false, error: "HTTP 502" });
    expect(report.placeSearch.engine).toBe("static-shards");
    expect(report.cron.driver).toBe("worker");
  });
});
