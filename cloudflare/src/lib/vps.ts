/**
 * Client for the VPS companion service (`vps/` in the repository): place
 * search over the full OpenStreetMap index, and the machine/index/cron report
 * the admin system page shows.
 *
 * It is reached through the `VPS` binding, a Workers VPC service over a
 * Cloudflare Tunnel: the service listens on the VPS's 127.0.0.1 and has no
 * public hostname, so nothing on the internet can reach it. The bearer token
 * (`VPS_SERVICE_TOKEN`) is a second lock behind that one.
 *
 * The VPS is one machine, so every caller has a fallback. After a failure
 * the client stops calling for `BREAK_MS` (per isolate): a dead VPS costs one
 * timeout, not one per request.
 */

export interface VpsEnv {
  VPS?: Fetcher;
  VPS_SERVICE_TOKEN?: string;
}

/** The URL the binding routes; the VPC service decides where it goes (127.0.0.1:8787). */
const ORIGIN = "http://127.0.0.1:8787";

/** Search must answer fast or fall back; the VPS answers in milliseconds. */
export const SEARCH_TIMEOUT_MS = 1500;
const BREAK_MS = 30_000;

let brokenUntil = 0;

export class VpsUnavailable extends Error {}

/** `GET /v1/status` of the VPS service (see `vps/src/http.rs`). */
export interface VpsStatus {
  service: { version: string; startedAt: string; uptimeSecs: number; timezone: string };
  system: {
    cpus: number;
    cpuPercent: number | null;
    processCpuPercent: number | null;
    loadAverage: [number, number, number] | null;
    memoryTotalBytes: number | null;
    memoryAvailableBytes: number | null;
    processRssBytes: number | null;
    diskTotalBytes: number | null;
    diskFreeBytes: number | null;
    systemUptimeSecs: number | null;
  };
  requests: Record<"search" | "reverse", VpsLatency>;
  index: {
    state: "ready" | "building" | "empty";
    places: number | null;
    terms: number | null;
    schedule: string;
    diskBytes: number;
    current: {
      generation: string;
      places: number;
      builtAt: string;
      sourceUrl: string;
      sourceMd5: string;
      profile: string;
    } | null;
    lastRun: {
      startedAt: string;
      finishedAt: string;
      outcome: "updated" | "unchanged" | "failed";
      detail: string;
      phasesMs: Record<string, number>;
      places: number | null;
      dropped: number | null;
      downloadBytes: number | null;
      extractorCpuSecs: number | null;
      extractorPeakRssBytes: number | null;
    } | null;
  };
  jobs: Array<{
    name: string;
    schedule: string;
    url: string;
    nextRunAt: string | null;
    runs: number;
    failures: number;
    consecutiveFailures: number;
    lastSuccessAt: string | null;
    lastRun: {
      startedAt: string;
      durationMs: number;
      ok: boolean;
      httpStatus: number | null;
      attempts: number;
      summary: string;
    } | null;
  }>;
}

export interface VpsLatency {
  count: number;
  errors: number;
  window: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
}

export function vpsConfigured(env: VpsEnv): boolean {
  return !!env.VPS && !!env.VPS_SERVICE_TOKEN;
}

export interface VpsGetOptions {
  timeoutMs?: number;
  /** Call even while the breaker is open (the admin page wants the truth). */
  ignoreBreaker?: boolean;
  /** Replaces the binding's fetch (tests). */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** GET a JSON resource of the VPS service; throws `VpsUnavailable` on any failure. */
export async function vpsGet<T>(env: VpsEnv, path: string, opts: VpsGetOptions = {}): Promise<T> {
  const { timeoutMs = SEARCH_TIMEOUT_MS, ignoreBreaker = false } = opts;
  const now = opts.now ?? Date.now;
  const { VPS: binding, VPS_SERVICE_TOKEN: token } = env;
  if (!binding || !token) throw new VpsUnavailable("VPS binding / VPS_SERVICE_TOKEN not set");
  if (!ignoreBreaker && now() < brokenUntil) throw new VpsUnavailable("recently unreachable");
  const fetchImpl =
    opts.fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit) => binding.fetch(input as string, init));
  try {
    const res = await fetchImpl(`${ORIGIN}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new VpsUnavailable(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    brokenUntil = now() + BREAK_MS;
    throw e instanceof VpsUnavailable
      ? e
      : new VpsUnavailable(e instanceof Error ? e.message : String(e));
  }
}

/** Test hook: forget a previous failure. */
export function resetVpsBreaker(): void {
  brokenUntil = 0;
}
