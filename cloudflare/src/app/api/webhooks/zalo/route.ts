import { getEnv } from "@/lib/db/client";
import { handleRouteError } from "@/lib/api";
import { verifyZalo } from "@/lib/webhooks";
import { badRequest } from "@/lib/services/http-errors";
import { handlePlatformMessage } from "@/lib/services/platform-chat";

interface ZaloEvent {
  event_name: string;
  sender: { id: string; name?: string | null };
  message?: { text?: string | null; msg_id?: string | null } | null;
}

/** `POST /api/webhooks/zalo` — Zalo OA events (`user_send_text` reaches the support chat). */
export async function POST(req: Request) {
  try {
    const body = new Uint8Array(await req.arrayBuffer());
    await verifyZalo(req.headers, body, (await getEnv()).ZALO_OA_SECRET);
    let event: ZaloEvent;
    try {
      event = JSON.parse(new TextDecoder().decode(body)) as ZaloEvent;
      if (typeof event.event_name !== "string" || typeof event.sender?.id !== "string")
        throw new Error("missing event_name or sender.id");
    } catch (e) {
      throw badRequest(`zalo payload parse failed: ${String(e)}`);
    }
    // `follow` / `unfollow` are acknowledged only: Rust's welcome reply is a log line.
    const text = event.message?.text;
    if (event.event_name === "user_send_text" && text) {
      await handlePlatformMessage({
        platform: "zalo",
        platformUserId: event.sender.id,
        userName: event.sender.name ?? "Khách Zalo",
        text,
        platformMsgId: event.message?.msg_id ?? null,
      });
    }
    return Response.json({ status: "ok" });
  } catch (e) {
    return handleRouteError(e);
  }
}
