import { getEnv } from "@/lib/db/client";
import { handleRouteError } from "@/lib/api";
import { verifyDiscord } from "@/lib/webhooks";
import { badRequest } from "@/lib/services/http-errors";
import { handlePlatformMessage } from "@/lib/services/platform-chat";

interface DiscordInteraction {
  type: number;
  id?: string | null;
  data?: {
    content?: string | null;
    options?: { name: string; value?: string | null }[] | null;
  } | null;
  member?: {
    user?: { id: string; username?: string | null; global_name?: string | null } | null;
  } | null;
}

const RECEIVED = "Tin nhắn của bạn đã được ghi nhận. Nhân viên sẽ phản hồi sớm.";

/** `POST /api/webhooks/discord` — interactions: answers Discord's PING, forwards command text to the support chat. */
export async function POST(req: Request) {
  try {
    const body = new Uint8Array(await req.arrayBuffer());
    await verifyDiscord(req.headers, body, (await getEnv()).DISCORD_PUBLIC_KEY);
    let interaction: DiscordInteraction;
    try {
      interaction = JSON.parse(new TextDecoder().decode(body)) as DiscordInteraction;
      if (typeof interaction.type !== "number") throw new Error("missing type");
    } catch (e) {
      throw badRequest(`discord payload parse failed: ${String(e)}`);
    }
    if (interaction.type === 1) return Response.json({ type: 1 });

    const data = interaction.data;
    const text =
      data?.content ??
      data?.options?.find((o) => o.name === "text" || o.name === "message")?.value ??
      null;
    if (!text) return Response.json({ type: 5 });

    const user = interaction.member?.user;
    await handlePlatformMessage({
      platform: "discord",
      platformUserId: user?.id ?? "unknown",
      userName: user?.global_name ?? user?.username ?? "Discord User",
      text,
      platformMsgId: interaction.id ?? null,
    });
    return Response.json({ type: 4, data: { content: RECEIVED } });
  } catch (e) {
    return handleRouteError(e);
  }
}
