import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, parsePagination, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { getEnv } from "@/lib/db/client";

/**
 * `GET /api/nullclaw/exchanges` — AI exchange audit log. Needs the
 * `admin:nullclaw:read` permission: prompts and completions carry customer
 * PII (phones, booking codes, travel plans). Empty when the assistant is
 * disabled on this deployment.
 */
export async function GET(req: Request) {
  try {
    await requirePermission(await requireStaff(req), "admin:nullclaw:read");
    const env = await getEnv();
    if (!(env.NULLCLAW_ENABLED === "1" || env.NULLCLAW_ENABLED === "true")) {
      return Response.json({ items: [] });
    }
    const url = new URL(req.url);
    const { limit, offset } = parsePagination(url, 50, 200);
    const items = await rawAll<Record<string, unknown>>(sql`
      SELECT id, channel_id, user_message_id, assistant_message_id, model,
             prompt, completion, latency_ms, handoff_to_human, created_at
      FROM nullclaw_exchange
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
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
