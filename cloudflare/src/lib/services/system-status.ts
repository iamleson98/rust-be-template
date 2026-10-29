/**
 * The admin system report (`GET /api/admin/system`): what actually runs the
 * site now — the Worker, D1, the cron driver, and the VPS service (place
 * search, OSM index, machine resources). Anything that cannot be measured is
 * `null`, never a made-up zero.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DRIVER_JOB, DRIVER_STALE_MS, HEARTBEAT_WINDOW_MS, latestRun } from "@/lib/services/jobs";
import { vpsConfigured, vpsGet, type VpsStatus } from "@/lib/vps";

/** Module load time: how long this isolate has been alive. */
const ISOLATE_STARTED = Date.now();
const VPS_STATUS_TIMEOUT_MS = 3000;

export interface SystemReport {
  checkedAt: string;
  worker: {
    /** Cloudflare data centre that served this request (IATA code). */
    colo: string | null;
    appEnv: string | null;
    isolateUptimeSecs: number;
  };
  database: {
    reachable: boolean;
    latencyMs: number | null;
    sizeBytes: number | null;
    tables: number | null;
    error: string | null;
  };
  cron: {
    /** Who runs the jobs: the VPS, the Worker's fallback trigger, or nobody. */
    driver: "vps" | "worker" | "stopped";
    lastDriverTickAt: string | null;
    lastSweepAt: string | null;
  };
  placeSearch: { engine: "vps" | "static-shards" };
  vps: {
    configured: boolean;
    reachable: boolean;
    latencyMs: number | null;
    error: string | null;
    status: VpsStatus | null;
  };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ageMs = (iso: string | null | undefined) =>
  iso ? Date.now() - new Date(iso).getTime() : Number.POSITIVE_INFINITY;

async function probeDatabase(db: D1Database): Promise<SystemReport["database"]> {
  const started = Date.now();
  try {
    const res = await db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
      .all<{ n: number }>();
    const size = (res.meta as { size_after?: number }).size_after;
    return {
      reachable: true,
      latencyMs: Date.now() - started,
      sizeBytes: typeof size === "number" ? size : null,
      tables: res.results[0]?.n ?? null,
      error: null,
    };
  } catch (e) {
    return { reachable: false, latencyMs: null, sizeBytes: null, tables: null, error: message(e) };
  }
}

async function cronState(): Promise<SystemReport["cron"]> {
  const [driver, sweep] = await Promise.all([latestRun(DRIVER_JOB), latestRun("holds.sweep")]);
  const lastDriverTickAt = driver?.createdAt ?? null;
  const lastSweepAt = sweep?.createdAt ?? null;
  return {
    driver:
      ageMs(lastDriverTickAt) < DRIVER_STALE_MS
        ? "vps"
        : ageMs(lastSweepAt) < HEARTBEAT_WINDOW_MS
          ? "worker"
          : "stopped",
    lastDriverTickAt,
    lastSweepAt,
  };
}

async function vpsState(env: CloudflareEnv): Promise<SystemReport["vps"]> {
  if (!vpsConfigured(env)) {
    return { configured: false, reachable: false, latencyMs: null, error: null, status: null };
  }
  const started = Date.now();
  try {
    const status = await vpsGet<VpsStatus>(env, "/v1/status", {
      timeoutMs: VPS_STATUS_TIMEOUT_MS,
      ignoreBreaker: true,
    });
    return {
      configured: true,
      reachable: true,
      latencyMs: Date.now() - started,
      error: null,
      status,
    };
  } catch (e) {
    return { configured: true, reachable: false, latencyMs: null, error: message(e), status: null };
  }
}

export async function systemReport(): Promise<SystemReport> {
  const { env, cf } = await getCloudflareContext({ async: true });
  const [database, cron, vps] = await Promise.all([
    probeDatabase(env.DB),
    cronState().catch(() => ({
      driver: "stopped" as const,
      lastDriverTickAt: null,
      lastSweepAt: null,
    })),
    vpsState(env),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    worker: {
      colo: (cf as { colo?: string } | undefined)?.colo ?? null,
      appEnv: env.APP_ENV ?? null,
      isolateUptimeSecs: Math.floor((Date.now() - ISOLATE_STARTED) / 1000),
    },
    database,
    cron,
    placeSearch: {
      engine: vps.reachable && vps.status?.index.state !== "empty" ? "vps" : "static-shards",
    },
    vps,
  };
}
