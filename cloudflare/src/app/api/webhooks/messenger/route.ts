import { getEnv } from "@/lib/db/client";
import { handleRouteError } from "@/lib/api";
import { verifyMessenger, verifyMessengerChallenge } from "@/lib/webhooks";
import { badRequest } from "@/lib/services/http-errors";
import { handlePlatformMessage } from "@/lib/services/platform-chat";

interface MessengerPayload {
  entry: { messaging: { sender: { id: string }; message?: { text?: string | null; mid?: string | null } | null }[] }[];
}

/** `GET /api/webhooks/messenger` — Meta's subscription handshake: echo `hub.challenge` for the right verify token. */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const [mode, token, challenge] = ["hub.mode", "hub.verify_token", "hub.challenge"].map((k) => q.get(k));
    if (mode === null || token === null || challenge === null)
      throw badRequest("missing hub.mode, hub.verify_token or hub.challenge");
    if (mode !== "subscribe") throw badRequest("invalid hub.mode");
    await verifyMessengerChallenge(token, (await getEnv()).MESSENGER_VERIFY_TOKEN);
    return new Response(challenge);
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/webhooks/messenger` — page messages reach the support chat. */
export async function POST(req: Request) {
  try {
    const body = new Uint8Array(await req.arrayBuffer());
    await verifyMessenger(req.headers, body, (await getEnv()).MESSENGER_APP_SECRET);
    let payload: MessengerPayload;
    try {
      payload = JSON.parse(new TextDecoder().decode(body)) as MessengerPayload;
      if (!Array.isArray(payload.entry) || payload.entry.some((e) => !Array.isArray(e.messaging)))
        throw new Error("missing entry[].messaging");
    } catch (e) {
      throw badRequest(`messenger payload parse failed: ${String(e)}`);
    }
    for (const entry of payload.entry) {
      for (const m of entry.messaging) {
        if (!m.message?.text) continue;
        await handlePlatformMessage({
          platform: "messenger",
          platformUserId: m.sender.id,
          userName: `FB User ${m.sender.id.slice(0, 8)}`,
          text: m.message.text,
          platformMsgId: m.message.mid ?? null,
        });
      }
    }
    return Response.json({ status: "ok" });
  } catch (e) {
    return handleRouteError(e);
  }
}
