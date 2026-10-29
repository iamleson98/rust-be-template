/**
 * Cron entry points. Both run straight from custom-worker.ts inside the
 * OpenNext request context: no Next.js router, middleware or route compile
 * sits between the caller and the jobs, which keeps an invocation inside the
 * Free plan's 10 ms CPU budget (the Next handler alone costs more than that
 * on a cold isolate).
 *
 * - `handleTickRequest`: `POST /api/jobs/tick` from the VPS service (every
 *   minute) or a manual run, authenticated with CRON_SERVICE_TOKEN.
 * - `runScheduledCron`: the Worker's Cron Trigger, a safety net that only
 *   runs the tick while the VPS has stopped ticking.
 */
import { err } from "@/lib/api";
import { timingSafeEqualStr } from "@/lib/auth/crypto";
import { getEnv } from "@/lib/db/client";
import { externalDriverActive, noteExternalTick, tick, type JobOutcome } from "@/lib/services/jobs";

/** One log line per tick: `holds.sweep=ok coupons.expire=failed(...)`. */
export function summarize(ran: JobOutcome[]): string {
  if (ran.length === 0) return "nothing due";
  return ran
    .map((r) => `${r.jobType}=${r.status === "failed" ? `failed(${r.error})` : r.status}`)
    .join(" ");
}

/**
 * Runs one tick. Throws when a job failed, so Workers observability marks the
 * cron invocation as failed (the failure is also recorded in `job_run`).
 */
export async function runCron(): Promise<string> {
  const { ran } = await tick();
  const summary = summarize(ran);
  if (ran.some((r) => r.status === "failed")) throw new Error(`cron tick failed: ${summary}`);
  return summary;
}

/** The Cron Trigger: stand down while the VPS drives the jobs. */
export async function runScheduledCron(): Promise<string> {
  if (await externalDriverActive()) return "skipped: the VPS driver is ticking";
  return `fallback tick: ${await runCron()}`;
}

/**
 * `POST /api/jobs/tick`. 200 `{ ok: true, ran }` when every due job
 * succeeded; 500 `{ ok: false, ran }` when one failed, so the driver retries
 * and reports it.
 */
export async function handleTickRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") return err(405, "method_not_allowed", "POST only");
  const expected = (await getEnv()).CRON_SERVICE_TOKEN;
  const provided = req.headers.get("x-cron-token");
  if (!expected || !provided || !timingSafeEqualStr(provided, expected)) {
    return err(401, "unauthorized", "Invalid cron service token");
  }
  const { ran } = await tick();
  await noteExternalTick();
  const ok = !ran.some((r) => r.status === "failed");
  return Response.json({ ok, ran }, { status: ok ? 200 : 500 });
}
