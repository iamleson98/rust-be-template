import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";
import { getEnv } from "@/lib/db/client";

/**
 * `GET /api/nullclaw/exchanges` — AI exchange audit log (admin). Empty
 * when the assistant is disabled on this deployment.
 */
export async function GET(req: Request) {
  try {
    const env = await getEnv();
    if (!(env.NULLCLAW_ENABLED === "1" || env.NULLCLAW_ENABLED === "true")) {
      return Response.json({ items: [] });
    }
    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
      200,
    );
    const items = await rawAll<Record<string, unknown>>(sql`
      SELECT id, channel_id, user_message_id, assistant_message_id, model,
             prompt, completion, latency_ms, handoff_to_human, created_at
      FROM nullclaw_exchange
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return Response.json({
      items: items.map((x) => ({
        id: x.id,
        channelId: x.channel_id,
        userMessageId: x.user_message_id,
        assistantMessageId: x.assistant_message_id,
        model: x.model,
        prompt: x.prompt,
        completion: x.completion,
        latencyMs: x.latency_ms,
        handoffToHuman: !!x.handoff_to_human,
        createdAt: x.created_at,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
