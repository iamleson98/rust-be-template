/**
 * Chat service — D1-backed support channels (port of chat_service.rs).
 * Live delivery/presence/audio runs on Cloudflare Realtime meetings keyed
 * by channel; this REST layer is the durable source of truth + fallback.
 * Serialization matches the SPA SDK contract (`ChatChannelOut`).
 */
import { getDb, rawAll, atomicBatch, type Database } from "@/lib/db/client";
import { chatAssignments, chatChannelMembers, chatChannels, chatMessages, users } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { ApiError } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";

export interface ChannelUserOut {
  id: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

export interface ChatChannelOut {
  id: string;
  userId: string;
  user?: ChannelUserOut | null;
  brandId?: string | null;
  topic?: string | null;
  status: string;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  unreadUser: number;
  unreadEmployee: number;
  createdAt: string;
  assignedTo?: ChannelUserOut | null;
  assignedToMe?: boolean;
}

/** Customer: create-or-reuse own open channel. */
export async function ensureCustomerChannel(
  userId: string,
  brandId?: string | null,
  topic?: string,
): Promise<typeof chatChannels.$inferSelect> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.userId, userId), sql`${chatChannels.status} != 'closed'`))
    .orderBy(desc(chatChannels.createdAt))
    .limit(1);
  if (existing[0]) return existing[0];
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ch: typeof chatChannels.$inferSelect = {
    id,
    userId,
    brandId: brandId ?? null,
    topic: topic ?? null,
    status: "open",
    priority: "normal",
    lastMessageAt: null,
    lastMessagePreview: null,
    unreadUser: 0,
    unreadEmployee: 0,
    createdAt: now,
    closedAt: null,
    realtimeMeetingId: null,
  };
  await db.insert(chatChannels).values(ch);
  await db
    .insert(chatChannelMembers)
    .values({ id: crypto.randomUUID(), channelId: id, userId, role: "customer", joinedAt: now })
    .onConflictDoNothing();
  return ch;
}

interface ChannelRow {
  id: string;
  user_id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_avatar: string | null;
  brand_id: string | null;
  topic: string | null;
  status: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_user: number;
  unread_employee: number;
  created_at: string;
  assignee_id: string | null;
  assignee_name: string | null;
}

/** Channel rows joined with customer + active assignee, for serialization. */
function channelQuery(where: ReturnType<typeof sql>) {
  return sql`
    SELECT ch.id, ch.user_id,
           u.full_name AS customer_name, u.email AS customer_email,
           u.phone AS customer_phone, u.avatar_url AS customer_avatar,
           ch.brand_id, ch.topic, ch.status,
           ch.last_message_at, ch.last_message_preview,
           ch.unread_user, ch.unread_employee, ch.created_at,
           asg.employee_id AS assignee_id, au.full_name AS assignee_name
    FROM chat_channel ch
    JOIN user u ON u.id = ch.user_id
    LEFT JOIN chat_assignment asg ON asg.channel_id = ch.id AND asg.unassigned_at IS NULL
    LEFT JOIN user au ON au.id = asg.employee_id
    WHERE ${where}
    ORDER BY COALESCE(ch.last_message_at, ch.created_at) DESC
  `;
}

export function serializeChannel(r: ChannelRow, viewerId?: string): ChatChannelOut {
  const customer: ChannelUserOut = {
    id: r.user_id,
    fullName: r.customer_name,
    email: r.customer_email,
    phone: r.customer_phone,
    avatarUrl: r.customer_avatar,
  };
  const assignee = r.assignee_id
    ? { id: r.assignee_id, fullName: r.assignee_name }
    : null;
  return {
    id: r.id,
    userId: r.user_id,
    user: customer,
    brandId: r.brand_id,
    topic: r.topic,
    status: r.status,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    unreadUser: r.unread_user,
    unreadEmployee: r.unread_employee,
    createdAt: r.created_at,
    assignedTo: assignee,
    assignedToMe: !!r.assignee_id && r.assignee_id === viewerId,
  };
}

/** Channels visible to caller: customers see own; staff see the queue (brand-scoped). */
export async function listChannels(user: SessionUser): Promise<ChatChannelOut[]> {
  const staff = user.role === "employee" || user.role === "admin";
  const where = staff
    ? user.brandId
      ? sql`ch.status != 'closed' AND (ch.brand_id IS NULL OR ch.brand_id = ${user.brandId})`
      : sql`ch.status != 'closed'`
    : sql`ch.user_id = ${user.id}`;
  const rows = await rawAll<ChannelRow>(channelQuery(where));
  return rows.map((r) => serializeChannel(r, user.id));
}

/** Channels with activity since `since`, with a monotonic sequence stamp. */
export async function onlineChannels(): Promise<{
  items: ChatChannelOut[];
  seq: number;
  userIds: string[];
}> {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const rows = await rawAll<ChannelRow>(
    channelQuery(sql`ch.status != 'closed' AND COALESCE(ch.last_message_at, ch.created_at) >= ${cutoff}`),
  );
  const items = rows.map((r) => serializeChannel(r));
  return {
    items,
    seq: Date.now(),
    userIds: [...new Set(items.map((c) => c.userId))],
  };
}

export async function getChannelOut(user: SessionUser, channelId: string): Promise<ChatChannelOut> {
  const rows = await rawAll<ChannelRow>(channelQuery(sql`ch.id = ${channelId}`));
  const row = rows[0];
  if (!row) throw new ApiError(404, "not-found", "Channel not found");
  const staff = user.role === "employee" || user.role === "admin";
  if (!staff && row.user_id !== user.id) throw new ApiError(403, "forbidden", "Not your channel");
  return serializeChannel(row, user.id);
}

async function assertChannelAccess(user: SessionUser, channelId: string) {
  const db = await getDb();
  const ch = (await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1))[0];
  if (!ch) throw new ApiError(404, "not-found", "Channel not found");
  const staff = user.role === "employee" || user.role === "admin";
  if (!staff && ch.userId !== user.id)
    throw new ApiError(403, "forbidden", "Not your channel");
  return ch;
}

export async function listMessages(user: SessionUser, channelId: string, limit = 30, offset = 0) {
  await assertChannelAccess(user, channelId);
  const db = await getDb();
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.channelId, channelId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200))
    .offset(Math.max(offset, 0));
}

/** Post a message (idempotent per clientMsgId; updates channel preview/unread). */
export async function postMessage(
  user: SessionUser,
  channelId: string,
  body: { content?: string | null; clientMsgId?: string | null; kind?: string; attachments?: string | null },
): Promise<typeof chatMessages.$inferSelect> {
  const ch = await assertChannelAccess(user, channelId);
  const db = await getDb();
  const staff = user.role === "employee" || user.role === "admin";
  const senderType = staff ? "employee" : "user";
  const now = new Date().toISOString();
  const text = (body.content ?? "").trim();
  if (!text) throw new ApiError(400, "validation", "content required");
  if (text.length > 4000) throw new ApiError(400, "validation", "content too long");

  if (body.clientMsgId) {
    const existing = await db
      .select()
      .from(chatMessages)
      .where(
        and(eq(chatMessages.channelId, channelId), eq(chatMessages.clientMsgId, body.clientMsgId)),
      )
      .limit(1);
    if (existing[0]) return existing[0];
  }

  const id = crypto.randomUUID();
  const msg: typeof chatMessages.$inferSelect = {
    id,
    channelId,
    senderType,
    senderId: user.id,
    content: text,
    kind: body.kind ?? "text",
    status: "sent",
    attachments: body.attachments ?? null,
    clientMsgId: body.clientMsgId ?? null,
    createdAt: now,
  };
  const unreadCol = sql.raw(staff ? "unread_user" : "unread_employee");
  await atomicBatch([
    db.insert(chatMessages).values({
      id: msg.id,
      channelId,
      senderType,
      senderId: user.id,
      content: text,
      kind: msg.kind,
      status: "sent",
      attachments: msg.attachments,
      clientMsgId: msg.clientMsgId,
      createdAt: now,
    }),
    sql`
      UPDATE chat_channel SET last_message_at = ${now}, last_message_preview = ${text.slice(0, 80)},
        ${unreadCol} = ${unreadCol} + 1
      WHERE id = ${channelId}
    `,
    ch.status === "open" && staff
      ? sql`UPDATE chat_channel SET status = 'assigned' WHERE id = ${channelId} AND status = 'open'`
      : sql`SELECT 1`,
  ]);
  return msg;
}

export async function markRead(user: SessionUser, channelId: string) {
  await assertChannelAccess(user, channelId);
  const db = await getDb();
  const staff = user.role === "employee" || user.role === "admin";
  await db.run(
    staff
      ? sql`UPDATE chat_channel SET unread_employee = 0 WHERE id = ${channelId}`
      : sql`UPDATE chat_channel SET unread_user = 0 WHERE id = ${channelId}`,
  );
  return { ok: true };
}

export async function claimChannel(user: SessionUser, channelId: string) {
  await assertChannelAccess(user, channelId);
  const db = await getDb();
  const now = new Date().toISOString();
  await atomicBatch([
    db.insert(chatAssignments).values({
      id: crypto.randomUUID(),
      channelId,
      employeeId: user.id,
      assignedAt: now,
      unassignedAt: null,
    }),
    sql`UPDATE chat_channel SET status = 'assigned' WHERE id = ${channelId}`,
    db
      .insert(chatChannelMembers)
      .values({
        id: crypto.randomUUID(),
        channelId,
        userId: user.id,
        role: "employee",
        joinedAt: now,
        leftAt: null,
      })
      .onConflictDoNothing(),
  ]);
  return getChannelOut(user, channelId);
}

export async function releaseChannel(user: SessionUser, channelId: string) {
  await assertChannelAccess(user, channelId);
  const now = new Date().toISOString();
  await atomicBatch([
    sql`UPDATE chat_assignment SET unassigned_at = ${now} WHERE channel_id = ${channelId} AND unassigned_at IS NULL`,
    sql`UPDATE chat_channel SET status = 'open' WHERE id = ${channelId} AND status = 'assigned'`,
  ]);
  return getChannelOut(user, channelId);
}

export async function closeChannel(user: SessionUser, channelId: string) {
  const ch = await assertChannelAccess(user, channelId);
  const staff = user.role === "employee" || user.role === "admin";
  if (!staff && ch.status !== "open")
    throw new ApiError(403, "forbidden", "Only staff can close assigned channels");
  const now = new Date().toISOString();
  const db = await getDb();
  await db.run(sql`UPDATE chat_channel SET status = 'closed', closed_at = ${now} WHERE id = ${channelId}`);
  return getChannelOut(user, channelId);
}

export async function chatStats(db: Database) {
  const rows = await rawAll<{ status: string; n: number }>(
    sql`SELECT status, COUNT(*) AS n FROM chat_channel GROUP BY status`,
  );
  const map: Record<string, number> = { open: 0, assigned: 0, closed: 0 };
  for (const r of rows) map[r.status] = Number(r.n);
  return map;
}

void chatAssignments;
