/**
 * ChatHub bridge — lets the REST layer push lifecycle frames into the
 * WebSocket hub (channel_assigned / channel_released / channel_closed /
 * message) so both transports stay in sync.
 */
import { getEnv } from "@/lib/db/client";

export async function emitChatEvent(frame: Record<string, unknown>): Promise<void> {
  try {
    const env = await getEnv();
    const ns = env.CHAT_HUB;
    if (!ns) return;
    const id = ns.idFromName("global");
    await ns.get(id).fetch("http://chat-hub/emit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(frame),
    });
  } catch {
    // the hub is best-effort: REST stays authoritative without it
  }
}
