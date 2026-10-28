import { getEnv } from "@/lib/db/client";
import { handleRouteError } from "@/lib/api";
import { verifyTelegram } from "@/lib/webhooks";
import { badRequest } from "@/lib/services/http-errors";
import { handlePlatformMessage } from "@/lib/services/platform-chat";

interface TelegramUpdate {
  message?: {
    message_id: number;
    from?: {
      first_name?: string | null;
      last_name?: string | null;
      username?: string | null;
    } | null;
    chat: { id: number };
    text?: string | null;
  } | null;
}

/** `POST /api/webhooks/telegram` — bot updates; a text message reaches the support chat. */
export async function POST(req: Request) {
  try {
    await verifyTelegram(req.headers, (await getEnv()).TELEGRAM_WEBHOOK_SECRET);
    let update: TelegramUpdate;
    try {
      update = (await req.json()) as TelegramUpdate;
      if (update.message && typeof update.message.chat?.id !== "number")
        throw new Error("missing chat.id");
    } catch (e) {
      throw badRequest(`telegram payload parse failed: ${String(e)}`);
    }
    const msg = update.message;
    if (msg?.text) {
      const names = [msg.from?.first_name, msg.from?.last_name].filter((n): n is string => !!n);
      await handlePlatformMessage({
        platform: "telegram",
        platformUserId: String(msg.chat.id),
        userName: names.length ? names.join(" ") : (msg.from?.username ?? "TG User"),
        text: msg.text,
        platformMsgId: `tg-${msg.message_id}`,
      });
    }
    return Response.json({ status: "ok" });
  } catch (e) {
    return handleRouteError(e);
  }
}
