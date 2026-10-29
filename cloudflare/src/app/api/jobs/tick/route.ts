import { handleTickRequest } from "@/lib/cron";

/**
 * `POST /api/jobs/tick` under `next dev`. In production custom-worker.ts
 * answers this path before Next.js (cheaper on the Free plan's CPU budget);
 * both use the same handler.
 */
export const POST = (req: Request) => handleTickRequest(req);
