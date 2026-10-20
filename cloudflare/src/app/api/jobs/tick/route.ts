import { getEnv } from "@/lib/db/client";
import { handleRouteError, err } from "@/lib/api";
import { tick } from "@/lib/services/jobs";

/** Constant-time compare via equal-length digests (no length/prefix timing leak). */
async function tokensEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * POST /api/jobs/tick — cron entry point driven by the container scheduler.
 * Auth: X-Cron-Token header matching CRON_SERVICE_TOKEN (service-to-service).
 */
export async function POST(req: Request) {
  try {
    const env = await getEnv();
    const expected = env.CRON_SERVICE_TOKEN;
    const provided = req.headers.get("x-cron-token");
    if (!expected || !provided || !(await tokensEqual(provided, expected))) {
      return err(401, "unauthorized", "Invalid cron service token");
    }
    const result = await tick();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return handleRouteError(e);
  }
}
