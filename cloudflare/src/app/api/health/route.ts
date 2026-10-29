import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";

/** Live data (bindings, D1): never prerendered at build. */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let dbOk = false;
  try {
    const db = await getDb();
    await db.get(sql`select 1 as ok`);
    dbOk = true;
  } catch (e) {
    console.error("[health] db check failed", e);
  }
  return Response.json(
    {
      status: dbOk ? "ok" : "degraded",
      service: "datxevui-worker",
      db: dbOk ? "ok" : "error",
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503 },
  );
}
