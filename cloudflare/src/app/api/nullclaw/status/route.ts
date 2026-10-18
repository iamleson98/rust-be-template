import { handleRouteError } from "@/lib/api";
import { getEnv } from "@/lib/db/client";

/** `GET /api/nullclaw/status` — the AI chat assistant's config surface. */
export async function GET() {
  try {
    const env = await getEnv();
    const enabled = env.NULLCLAW_ENABLED === "1" || env.NULLCLAW_ENABLED === "true";
    return Response.json({ enabled, provider: env.NULLCLAW_PROVIDER ?? "nullclaw" });
  } catch (e) {
    return handleRouteError(e);
  }
}
