import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff, err } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";
import { getEnv } from "@/lib/db/client";

const BOOT = Date.now();

function humanUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * `GET /api/admin/system` — service status (Rust `SystemStatusResponse`).
 * On Workers the "process" is the isolate; the database is D1.
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "admin access required");
    const env = await getEnv();
    const seconds = Math.floor((Date.now() - BOOT) / 1000);

    const sizeMb = 0;
    try {
      const est = await rawAll<{ bytes: number }>(sql`
        SELECT (SELECT COUNT(*) FROM sqlite_master) AS bytes
      `);
      void est;
    } catch {
      // D1 size is not introspectable; the dashboard shows it instead.
    }

    return Response.json({
      uptime: { seconds, human: humanUptime(seconds) },
      process: {
        pid: 0,
        hostname: "cloudflare-workers",
        osName: "workerd",
        osVersion: "1",
        cpuCount: 0,
        cpuUsage: 0,
        memoryMb: 128,
        virtualMemoryMb: 128,
      },
      database: {
        backend: "d1",
        urlMasked: `d1:${(env.DB as unknown as { databaseId?: string })?.databaseId ?? "***"}`,
        sizeMb,
        activeConnections: 0,
        idleConnections: 0,
        maxConnections: 0,
        minConnections: 0,
        engine: {
          version: "d1 (sqlite)",
          connections: { live: 0, opened: 0, closed: 0 },
          memory: {
            cacheCapacityMb: 0,
            cacheMb: 0,
            dbSizeMb: sizeMb,
            freelistPages: 0,
            utilizationPct: 0,
            walFrames: 0,
          },
          throughput: {
            rowsPerSec: 0,
            rowsReturned: 0,
            statementsPrepared: 0,
            steps: 0,
            stepsPerSec: 0,
            totalChanges: 0,
            writesExecuted: 0,
            writesPerSec: 0,
          },
          cache: { hitRatePct: 0, hits: 0, misses: 0 },
          transactions: { active: false, begun: 0, committed: 0, rolledBack: 0 },
          contention: { busyTimeouts: 0, busyWaits: 0 },
          files: [],
        },
      },
      websocket: {
        connections: 0,
        maxConnections: 0,
        distinctIps: 0,
        rooms: 0,
        idempotencyEntries: 0,
        onlineEmployees: 0,
        onlineEmployeeBrands: 0,
        resources: {
          admitting: true,
          fdUsed: 0,
          fdSoftLimit: 0,
          fdUsedPct: 0,
          fdHighWatermarkPct: 0,
          memAvailableBytes: null,
          memFloorBytes: 0,
        },
      },
      calls: {
        sessions: 0,
        active: 0,
        ringing: 0,
        agentSockets: 0,
        janitorActiveExpired: 0,
        janitorRingExpired: 0,
        janitorRingRerouted: 0,
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
