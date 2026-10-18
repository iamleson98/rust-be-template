/**
 * Cloudflare Realtime (RealtimeKit) integration — replaces the Rust /ws +
 * /ws-call hubs (chat relay, presence, WebRTC signaling + TURN).
 *
 * Model:
 *  - Each support chat channel maps 1:1 to a RealtimeKit meeting.
 *  - POST /api/realtime/token mints a participant token via the
 *    "Add Participant" REST API (server-side, API token auth).
 *  - Clients join with @cloudflare/realtimekit-react: audio track = voice
 *    call; meeting chat = live text; participants = presence.
 *  - D1 keeps the durable chat history (REST persistence).
 *
 * Falls back to REST/polling when REALTIME_ENABLED != true.
 */
import { getDb, getEnv } from "@/lib/db/client";
import { chatChannels } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { ApiError } from "@/lib/auth/rbac";

const API_BASE = "https://api.cloudflare.com/client/v4";

export interface RealtimeConfig {
  enabled: boolean;
  appId: string;
  accountId: string;
  apiToken: string;
}

export async function realtimeConfig(): Promise<RealtimeConfig> {
  const env = await getEnv();
  return {
    enabled: env.REALTIME_ENABLED === "true",
    appId: env.REALTIME_APP_ID ?? "",
    accountId: env.REALTIME_ACCOUNT_ID ?? "",
    apiToken: env.REALTIME_API_TOKEN ?? "",
  };
}

interface CfResponse<T> {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result?: T;
}

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const cfg = await realtimeConfig();
  if (!cfg.enabled || !cfg.apiToken || !cfg.accountId || !cfg.appId) {
    throw new ApiError(503, "realtime-disabled", "Realtime is not configured");
  }
  const res = await fetch(
    `${API_BASE}/accounts/${cfg.accountId}/realtime/kit/${cfg.appId}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.apiToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    },
  );
  const body = (await res.json().catch(() => ({ success: false }))) as CfResponse<T>;
  if (!res.ok || !body.success) {
    throw new ApiError(
      502,
      "realtime-error",
      body.errors?.[0]?.message ?? `Realtime API error (${res.status})`,
    );
  }
  return body.result as T;
}

interface MeetingResult {
  id: string;
  status?: string;
  title?: string;
}

interface ParticipantResult {
  id: string;
  name?: string;
  token: string;
}

/** Find-or-create the meeting for a chat channel; caches the id on the row. */
export async function meetingForChannel(channelId: string): Promise<string> {
  const db = await getDb();
  const ch = (
    await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1)
  )[0];
  if (!ch) throw new ApiError(404, "not-found", "Channel not found");
  const existing = (ch as typeof chatChannels.$inferSelect & { realtimeMeetingId?: string | null })
    .realtimeMeetingId;
  if (existing) return existing;
  const meeting = await cf<MeetingResult>("/meetings", {
    method: "POST",
    body: JSON.stringify({
      title: `support-${channelId}`,
      // Audio-only support conversation.
      preset_name: "audio_only",
    }),
  });
  // Column added by migration 0002.
  await db.run(
    sql`UPDATE chat_channel SET realtime_meeting_id = ${meeting.id} WHERE id = ${channelId}`,
  );
  return meeting.id;
}

export interface RealtimeJoinInfo {
  enabled: boolean;
  meetingId: string | null;
  token: string | null;
  participantId: string | null;
  expiresInDays: number | null;
}

/**
 * Mint a join token for the caller. Audio-only preset; identity is pinned to
 * the session user (custom_participant_id) so presence maps back to D1 users.
 */
export async function mintChannelToken(
  channelId: string,
  user: { id: string; fullName: string; role: string },
): Promise<RealtimeJoinInfo> {
  const cfg = await realtimeConfig();
  if (!cfg.enabled)
    return {
      enabled: false,
      meetingId: null,
      token: null,
      participantId: null,
      expiresInDays: null,
    };
  const meetingId = await meetingForChannel(channelId);
  const preset = user.role === "user" ? "audio_only" : "audio_only";
  const participant = await cf<ParticipantResult>(`/meetings/${meetingId}/participants`, {
    method: "POST",
    body: JSON.stringify({
      name: user.fullName,
      preset_name: preset,
      custom_participant_id: user.id,
      custom_participant_data: { role: user.role, channelId },
    }),
  });
  return {
    enabled: true,
    meetingId,
    token: participant.token,
    participantId: participant.id,
    expiresInDays: 100,
  };
}
