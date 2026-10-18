import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";

const VERSION = "0.6.0";

/** `GET /health` — liveness + DB probe (Rust `HealthResponse`). */
export async function GET() {
  try {
    await rawAll(sql`SELECT 1 AS ok`);
    return Response.json({ status: "ok", version: VERSION });
  } catch {
    return Response.json({ status: "degraded", version: VERSION }, { status: 503 });
  }
}
