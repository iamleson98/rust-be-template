/**
 * What a Cron Trigger runs. `custom-worker.ts` calls this straight from
 * `scheduled()`, inside the OpenNext request context: no Next.js router,
 * middleware or route compile sits between the trigger and the jobs, which keeps
 * the invocation inside the Free plan's 10 ms CPU budget (the Next handler alone
 * costs more than that on a cold isolate) and removes the need for a shared
 * token. `POST /api/jobs/tick` stays for manual runs.
 */
import { tick, type JobOutcome } from "@/lib/services/jobs";

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
