/**
 * ChatHub bridge — how the REST layer talks to the WebSocket hub, the one
 * place that knows who is connected. Every call is best-effort: REST stays
 * authoritative (D1) when the hub is absent or unreachable.
 */
import { getEnv } from "@/lib/db/client";
import type { RoutingOutcome, staffPresenceFrame } from "@/lib/chat/presence";

/** A stored message, as the hub fans it out. */
export interface DeliveredMessage {
  id: string;
  channelId: string;
  senderType: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

async function callHub<T>(path: string, init?: { body: unknown }): Promise<T | null> {
  try {
    const ns = (await getEnv()).CHAT_HUB;
    if (!ns) return null;
    const res = await ns.get(ns.idFromName("global")).fetch(`http://chat-hub${path}`, {
      method: init ? "POST" : "GET",
      ...(init && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(init.body),
      }),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Who hears a lifecycle frame: everyone, the staff, or the sockets in the frame's channel room. */
export type EmitScope = "all" | "staff" | "room";

/** Push a lifecycle frame (channel_created / assigned / released / closed …). */
export async function emitChatEvent(
  frame: Record<string, unknown>,
  scope: EmitScope,
): Promise<void> {
  await callHub("/emit", { body: { frame, scope } });
}

/**
 * A message was stored: broadcast it to the channel room and, for a
 * customer's, route it to staff and notify them.
 */
export async function hubDeliver(message: DeliveredMessage): Promise<void> {
  await callHub("/deliver", { body: message });
}

/** Route a channel's customer to the most available staff member (null: hub unreachable). */
export async function hubRoute(channelId: string): Promise<RoutingOutcome | null> {
  return callHub<RoutingOutcome>("/route", { body: { channelId } });
}

/** The customers connected right now, ordered by a sequence number (`/channels/online`). */
export async function hubBrowse(): Promise<{ seq: number; userIds: string[] }> {
  return (
    (await callHub<{ seq: number; userIds: string[] }>("/online-customers")) ?? {
      seq: 0,
      userIds: [],
    }
  );
}

/** `GET /api/presence/staff`: live staff plus the recently-active offline roster. */
export async function hubStaff() {
  return (
    (await callHub<StaffSnapshot>("/staff")) ?? {
      staff: [],
      offline: [],
      onlineCount: 0,
      availableCount: 0,
      botActive: true,
    }
  );
}

type StaffSnapshot = ReturnType<typeof staffPresenceFrame> & { offline: unknown[] };
