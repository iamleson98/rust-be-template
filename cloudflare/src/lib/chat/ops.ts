/**
 * Chat writes and routing — the store half of `chat_service.rs`, written
 * against a bare `D1Database` so the REST service and the ChatHub Durable
 * Object (which has no Next.js request context) run the exact same code.
 */
import { pickBestAvailable, botActive, type RoutingOutcome, type StaffEntry } from "./presence";

export interface ChannelRow {
  id: string;
  user_id: string;
  brand_id: string | null;
  topic: string | null;
  status: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_user: number;
  unread_employee: number;
  created_at: string;
  closed_at: string | null;
}

export interface MessageRow {
  id: string;
  channel_id: string;
  sender_type: string;
  sender_id: string | null;
  content: string | null;
  kind: string;
  attachments: string | null;
  status: string;
  client_msg_id: string | null;
  created_at: string;
}

export interface NewMessage {
  channelId: string;
  /** `user` | `employee` | `system` | `assistant`. */
  senderType: string;
  senderId: string | null;
  content: string | null;
  kind?: string;
  attachments?: string | null;
  clientMsgId?: string | null;
}

/** The channel preview is the first 100 characters of the last message. */
export const PREVIEW_CHARS = 100;

/** Message and attachment limits shared by the REST and socket send paths (`CreateMessageRequest`). */
export const MAX_CONTENT_CHARS = 10_000;

export const unreadSide = (senderType: string): "user" | "employee" =>
  senderType === "user" ? "employee" : "user";

export async function getChannel(d1: D1Database, id: string): Promise<ChannelRow | null> {
  return d1.prepare(`SELECT * FROM chat_channel WHERE id = ? LIMIT 1`).bind(id).first<ChannelRow>();
}

export async function findMessageByClientId(
  d1: D1Database,
  channelId: string,
  clientMsgId: string,
): Promise<MessageRow | null> {
  return d1
    .prepare(`SELECT * FROM chat_message WHERE channel_id = ? AND client_msg_id = ? LIMIT 1`)
    .bind(channelId, clientMsgId)
    .first<MessageRow>();
}

/**
 * Rust `insert_message` + the unread bump every send path does next: one
 * atomic batch stores the message, moves the channel preview to its first
 * 100 characters and grows the OTHER side's unread counter. System notices
 * (`senderType: "system"`) bump the customer side like any non-customer.
 */
export async function insertMessage(d1: D1Database, msg: NewMessage): Promise<MessageRow> {
  const row: MessageRow = {
    id: crypto.randomUUID(),
    channel_id: msg.channelId,
    sender_type: msg.senderType,
    sender_id: msg.senderId,
    content: msg.content,
    kind: msg.kind ?? "text",
    attachments: msg.attachments ?? null,
    status: "sent",
    client_msg_id: msg.clientMsgId || null,
    created_at: new Date().toISOString(),
  };
  const preview = [...(row.content ?? "")].slice(0, PREVIEW_CHARS).join("");
  const unread = unreadSide(msg.senderType) === "user" ? "unread_user" : "unread_employee";
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO chat_message (id, channel_id, sender_type, sender_id, content, kind, attachments, status, client_msg_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.id,
        row.channel_id,
        row.sender_type,
        row.sender_id,
        row.content,
        row.kind,
        row.attachments,
        row.status,
        row.client_msg_id,
        row.created_at,
      ),
    d1
      .prepare(
        `UPDATE chat_channel SET last_message_preview = ?, last_message_at = ?, ${unread} = ${unread} + 1 WHERE id = ?`,
      )
      .bind(preview, row.created_at, row.channel_id),
  ]);
  return row;
}

export async function clearUnread(
  d1: D1Database,
  channelId: string,
  side: "user" | "employee",
): Promise<void> {
  const col = side === "user" ? "unread_user" : "unread_employee";
  await d1.prepare(`UPDATE chat_channel SET ${col} = 0 WHERE id = ?`).bind(channelId).run();
}

// ── Assignments ─────────────────────────────────────────────────

export interface AssignmentRow {
  id: string;
  channel_id: string;
  employee_id: string | null;
  assigned_at: string;
  unassigned_at: string | null;
}

export async function activeAssignment(
  d1: D1Database,
  channelId: string,
): Promise<AssignmentRow | null> {
  return d1
    .prepare(
      `SELECT * FROM chat_assignment WHERE channel_id = ? AND unassigned_at IS NULL ORDER BY assigned_at DESC LIMIT 1`,
    )
    .bind(channelId)
    .first<AssignmentRow>();
}

/** Active channels per employee: the chat-load input of the picker. */
export async function activeLoads(d1: D1Database): Promise<Map<string, number>> {
  const { results } = await d1
    .prepare(
      `SELECT employee_id, COUNT(*) AS n FROM chat_assignment
       WHERE unassigned_at IS NULL AND employee_id IS NOT NULL GROUP BY employee_id`,
    )
    .all<{ employee_id: string; n: number }>();
  return new Map(results.map((r) => [r.employee_id, Number(r.n)]));
}

/**
 * Rust `upsert_assignment`: one assignment row per channel (a re-assignment
 * reuses it, so the history stays single-line) and the channel turns
 * `assigned`.
 */
export async function upsertAssignment(
  d1: D1Database,
  channelId: string,
  employeeId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await d1
    .prepare(`SELECT id FROM chat_assignment WHERE channel_id = ? ORDER BY assigned_at DESC LIMIT 1`)
    .bind(channelId)
    .first<{ id: string }>();
  await d1.batch([
    existing
      ? d1
          .prepare(
            `UPDATE chat_assignment SET employee_id = ?, assigned_at = ?, unassigned_at = NULL WHERE id = ?`,
          )
          .bind(employeeId, now, existing.id)
      : d1
          .prepare(
            `INSERT INTO chat_assignment (id, channel_id, employee_id, assigned_at, unassigned_at) VALUES (?, ?, ?, ?, NULL)`,
          )
          .bind(crypto.randomUUID(), channelId, employeeId, now),
    d1.prepare(`UPDATE chat_channel SET status = 'assigned' WHERE id = ?`).bind(channelId),
  ]);
}

/** Rust `release_assignment`: end the active row and put the channel back in the open queue. */
export async function releaseAssignment(d1: D1Database, channelId: string): Promise<void> {
  const now = new Date().toISOString();
  await d1.batch([
    d1
      .prepare(
        `UPDATE chat_assignment SET unassigned_at = ? WHERE channel_id = ? AND unassigned_at IS NULL`,
      )
      .bind(now, channelId),
    d1.prepare(`UPDATE chat_channel SET status = 'open' WHERE id = ?`).bind(channelId),
  ]);
}

/** Rust `close_channel`: ends any assignment (the audit trail stays) and closes the channel. */
export async function closeChannelRow(d1: D1Database, channelId: string): Promise<void> {
  const now = new Date().toISOString();
  await d1.batch([
    d1
      .prepare(
        `UPDATE chat_assignment SET unassigned_at = ? WHERE channel_id = ? AND unassigned_at IS NULL`,
      )
      .bind(now, channelId),
    d1
      .prepare(`UPDATE chat_channel SET status = 'closed', closed_at = ? WHERE id = ?`)
      .bind(now, channelId),
  ]);
}

export async function addMember(
  d1: D1Database,
  channelId: string,
  userId: string,
  role: string,
): Promise<void> {
  await d1
    .prepare(
      `INSERT OR IGNORE INTO chat_channel_member (id, channel_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), channelId, userId, role, new Date().toISOString())
    .run();
}

// ── Routing ─────────────────────────────────────────────────────

/**
 * Rust `route_user_message`: decide who owns a customer's message. Runs on
 * EVERY customer message and is one SELECT when the assignee is online.
 * `staff` is the live roster (with chat load); the caller applies the
 * outcome to its presence bookkeeping (`assigned` / `admin` picks).
 */
export async function routeUserMessage(
  d1: D1Database,
  channelId: string,
  staff: StaffEntry[],
): Promise<RoutingOutcome> {
  const channel = await getChannel(d1, channelId);
  if (!channel) throw new Error("chat channel not found");

  const assignment = await activeAssignment(d1, channelId);
  const assignee = assignment?.employee_id;
  let roster = staff;
  if (assignee) {
    if (staff.some((s) => s.userId === assignee && s.online)) {
      return { kind: "assignee", employeeId: assignee };
    }
    // The assignee went offline: release so the picker can find someone live.
    await releaseAssignment(d1, channelId);
    roster = staff.map((s) =>
      s.userId === assignee ? { ...s, activeChats: Math.max(s.activeChats - 1, 0) } : s,
    );
  }

  if (channel.status === "closed") return { kind: "queued" };

  const picked = pickBestAvailable(roster, channel.brand_id);
  if (!picked) return botActive(roster, channel.brand_id) ? { kind: "bot" } : { kind: "queued" };
  if (picked.role === "admin") return { kind: "admin", adminId: picked.userId };
  await upsertAssignment(d1, channelId, picked.userId);
  return { kind: "assigned", employeeId: picked.userId };
}
