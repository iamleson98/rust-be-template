/**
 * datxevui cron container — the scheduled-job DRIVER.
 *
 * Architecture (per the Cloudflare migration plan):
 *   ┌────────────────────┐  every minute   ┌──────────────────────────┐
 *   │ Cloudflare         │ ──POST /api/jobs/tick (X-Cron-Token)──▶ │ Next.js Worker            │
 *   │ Container (this)   │                 │ (OpenNext on Workers)     │
 *   └────────────────────┘                 │  → holds.sweep every tick │
 *        ▲ kept awake by its own           │  → trips.warm every 6h    │
 *          HTTP health server              │  → scheduled_job table    │
 *                                          │    (coupons.expire, …)    │
 *                                          └───────────┬──────────────┘
 *                                                      │ D1
 *                                          ┌───────────▼──────────────┐
 *                                          │ Cloudflare D1 (SQLite)   │
 *                                          └──────────────────────────┘
 *
 * Why a container at all (vs Worker Cron Triggers)? The user's migration plan
 * pins cron jobs in a Container: it keeps long-running, stateful schedulers
 * (node-cron), survives Worker cold starts, and can later host heavier jobs
 * (OSM re-indexing) that exceed Workers CPU limits. The Worker stays the
 * EXECUTOR so all DB writes still go through D1 bindings (containers cannot
 * bind D1/R2 directly).
 *
 * The embedded HTTP server exists because Cloudflare Containers require a
 * listening port for health checks (the Durable Object wrapper polls it).
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const APP_URL = process.env.APP_URL ?? "http://datxevui.example.workers.dev";
const CRON_TOKEN = process.env.CRON_SERVICE_TOKEN ?? "";
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 60_000);
const WARM_INTERVAL_MS = Number(process.env.WARM_INTERVAL_MS ?? 6 * 3600_000);

if (!CRON_TOKEN) {
  console.error("[cron] CRON_SERVICE_TOKEN is required (must match the Worker's secret)");
  process.exit(1);
}

let lastTickAt = 0;
let lastWarmAt = 0;
let running = false;
let consecutiveFailures = 0;
const history = [];

async function callTick(reason: string): Promise<void> {
  if (running) {
    console.log(`[cron] tick skipped (${reason}): previous tick still running`);
    return;
  }
  running = true;
  const startedAt = Date.now();
  try {
    const res = await fetch(`${APP_URL}/api/jobs/tick`, {
      method: "POST",
      headers: { "X-Cron-Token": CRON_TOKEN },
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    consecutiveFailures = 0;
    history.unshift({ reason, ok: true, ms: Date.now() - startedAt, at: new Date().toISOString() });
    history.length = Math.min(history.length, 50);
    console.log(`[cron] tick ok (${reason}) in ${Date.now() - startedAt}ms: ${body.slice(0, 300)}`);
  } catch (e) {
    consecutiveFailures++;
    history.unshift({
      reason,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      at: new Date().toISOString(),
    });
    history.length = Math.min(history.length, 50);
    console.error(`[cron] tick failed (${reason}, failures=${consecutiveFailures}):`, e);
  } finally {
    running = false;
  }
}

// Per-minute tick: drives holds.sweep + table-driven jobs.
setInterval(() => {
  lastTickAt = Date.now();
  void callTick("minute");
}, TICK_INTERVAL_MS);

// Belt-and-braces 6h warm ping (the Worker itself also gates trips.warm on the
// last successful run, so this is idempotent).
setInterval(() => {
  lastWarmAt = Date.now();
  void callTick("warm");
}, WARM_INTERVAL_MS);

// Health/observability endpoint (required pattern for Cloudflare Containers).
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "datxevui-cron",
        lastTickAt: lastTickAt ? new Date(lastTickAt).toISOString() : null,
        lastWarmAt: lastWarmAt ? new Date(lastWarmAt).toISOString() : null,
        consecutiveFailures,
        target: APP_URL,
      }),
    );
    return;
  }
  if (req.url === "/history") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ history }, null, 2));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[cron] datxevui cron container listening on :${PORT}, target ${APP_URL}`);
  // Fire an initial tick shortly after boot.
  setTimeout(() => void callTick("boot"), 3_000);
});

function shutdown() {
  console.log("[cron] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
