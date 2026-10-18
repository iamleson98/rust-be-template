/**
 * Chat service — D1-backed support channels (port of chat_service.rs).
 * Live delivery/presence/audio runs on Cloudflare Realtime meetings keyed
 * by channel; this REST layer is the durable source of truth + fallback.
 * Serialization matches the SPA SDK contract (`ChatChannelOut`).
 */
import { getDb, atomicBatch, type AtomicStatement, type Database } from "@/lib/db/client";
import {
  chatAssignments,
  chatChannelMembers,
  chatChannels,
  chatMessages,
  users,
} from "@/lib/db/schema";
import { and, desc, eq, gte, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
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
    .where(and(eq(chatChannels.userId, userId), ne(chatChannels.status, "closed")))
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

/** The joined, serializer-ready channel row — built by the typed query
 * builder below (chat_channel + customer + active assignee + assignee
 * user), so every column name is compiler-checked. */
interface ChannelJoinedRow {
  channel: typeof chatChannels.$inferSelect;
  customer: { fullName: string; email: string; phone: string | null; avatarUrl: string | null };
  assignee: { employeeId: string | null; fullName: string | null } | null;
}

/** Channel rows joined with customer + active assignee, ordered by most
 * recent activity (COALESCE(last_message_at, created_at) DESC). */
async function channelRows(db: Database, where: SQL | undefined): Promise<ChannelJoinedRow[]> {
  const assigneeUser = alias(users, "au");
  const flat = await db
    .select({
      channel: chatChannels,
      customerName: users.fullName,
      customerEmail: users.email,
      customerPhone: users.phone,
      customerAvatar: users.avatarUrl,
      assigneeId: chatAssignments.employeeId,
      assigneeName: assigneeUser.fullName,
    })
    .from(chatChannels)
    .innerJoin(users, eq(users.id, chatChannels.userId))
    .leftJoin(
      chatAssignments,
      and(eq(chatAssignments.channelId, chatChannels.id), isNull(chatAssignments.unassignedAt)),
    )
    .leftJoin(assigneeUser, eq(assigneeUser.id, chatAssignments.employeeId))
    .where(where)
    .orderBy(desc(sql`COALESCE(${chatChannels.lastMessageAt}, ${chatChannels.createdAt})`));
  return flat.map(toJoinedRow);
}

function toJoinedRow(r: {
  channel: typeof chatChannels.$inferSelect;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  customerAvatar: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
}): ChannelJoinedRow {
  return {
    channel: r.channel,
    customer: {
      fullName: r.customerName,
      email: r.customerEmail,
      phone: r.customerPhone,
      avatarUrl: r.customerAvatar,
    },
    assignee: r.assigneeId !== null ? { employeeId: r.assigneeId, fullName: r.assigneeName } : null,
  };
}

export function serializeChannel(r: ChannelJoinedRow, viewerId?: string): ChatChannelOut {
  const ch = r.channel;
  const customer: ChannelUserOut = {
    id: ch.userId,
    fullName: r.customer.fullName,
    email: r.customer.email,
    phone: r.customer.phone,
    avatarUrl: r.customer.avatarUrl,
  };
  const assignee =
    r.assignee !== null && r.assignee.employeeId !== null
      ? { id: r.assignee.employeeId, fullName: r.assignee.fullName }
      : null;
  return {
    id: ch.id,
    userId: ch.userId,
    user: customer,
    brandId: ch.brandId,
    topic: ch.topic,
    status: ch.status,
    lastMessageAt: ch.lastMessageAt,
    lastMessagePreview: ch.lastMessagePreview,
    unreadUser: ch.unreadUser,
    unreadEmployee: ch.unreadEmployee,
    createdAt: ch.createdAt,
    assignedTo: assignee,
    assignedToMe: assignee !== null && assignee.id === viewerId,
  };
}

/** Channels visible to caller: customers see own; staff see the queue (brand-scoped). */
export async function listChannels(user: SessionUser): Promise<ChatChannelOut[]> {
  const db = await getDb();
  const staff = user.role === "employee" || user.role === "admin";
  const where = staff
    ? user.brandId != null // narrows both null and undefined
      ? and(
          ne(chatChannels.status, "closed"),
          or(isNull(chatChannels.brandId), eq(chatChannels.brandId, user.brandId)),
        )
      : ne(chatChannels.status, "closed")
    : eq(chatChannels.userId, user.id);
  const rows = await channelRows(db, where);
  return rows.map((r) => serializeChannel(r, user.id));
}

/** Channels with activity since `since`, with a monotonic sequence stamp. */
export async function onlineChannels(): Promise<{
  items: ChatChannelOut[];
  seq: number;
  userIds: string[];
}> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const where = and(
    ne(chatChannels.status, "closed"),
    gte(sql`COALESCE(${chatChannels.lastMessageAt}, ${chatChannels.createdAt})`, cutoff),
  );
  const rows = await channelRows(db, where);
  const items = rows.map((r) => serializeChannel(r));
  return {
    items,
    seq: Date.now(),
    userIds: [...new Set(items.map((c) => c.userId))],
  };
}

export async function getChannelOut(user: SessionUser, channelId: string): Promise<ChatChannelOut> {
  const db = await getDb();
  const rows = await channelRows(db, eq(chatChannels.id, channelId));
  const row = rows[0];
  if (!row) throw new ApiError(404, "not-found", "Channel not found");
  const staff = user.role === "employee" || user.role === "admin";
  if (!staff && row.channel.userId !== user.id)
    throw new ApiError(403, "forbidden", "Not your channel");
  return serializeChannel(row, user.id);
}

async function assertChannelAccess(user: SessionUser, channelId: string) {
  const db = await getDb();
  const ch = (
    await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1)
  )[0];
  if (!ch) throw new ApiError(404, "not-found", "Channel not found");
  const staff = user.role === "employee" || user.role === "admin";
  if (!staff && ch.userId !== user.id) throw new ApiError(403, "forbidden", "Not your channel");
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
  body: {
    content?: string | null;
    clientMsgId?: string | null;
    kind?: string;
    attachments?: string | null;
  },
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
  const preview = text.slice(0, 80);
  // Staff messages bump the customer's unread counter; user messages the
  // staff one. One typed builder per side — no dynamic column names.
  const touchChannel =
    senderType === "employee"
      ? db
          .update(chatChannels)
          .set({
            lastMessageAt: now,
            lastMessagePreview: preview,
            unreadUser: sql`${chatChannels.unreadUser} + 1`,
          })
          .where(eq(chatChannels.id, channelId))
      : db
          .update(chatChannels)
          .set({
            lastMessageAt: now,
            lastMessagePreview: preview,
            unreadEmployee: sql`${chatChannels.unreadEmployee} + 1`,
          })
          .where(eq(chatChannels.id, channelId));
  const stmts: AtomicStatement[] = [
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
    touchChannel,
  ];
  if (ch.status === "open" && staff) {
    stmts.push(
      db
        .update(chatChannels)
        .set({ status: "assigned" })
        .where(and(eq(chatChannels.id, channelId), eq(chatChannels.status, "open"))),
    );
  }
  await atomicBatch(stmts);
  return msg;
}

export async function markRead(user: SessionUser, channelId: string) {
  await assertChannelAccess(user, channelId);
  const db = await getDb();
  const staff = user.role === "employee" || user.role === "admin";
  await db
    .update(chatChannels)
    .set(staff ? { unreadEmployee: 0 } : { unreadUser: 0 })
    .where(eq(chatChannels.id, channelId));
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
    db.update(chatChannels).set({ status: "assigned" }).where(eq(chatChannels.id, channelId)),
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
  const db = await getDb();
  const now = new Date().toISOString();
  await atomicBatch([
    db
      .update(chatAssignments)
      .set({ unassignedAt: now })
      .where(and(eq(chatAssignments.channelId, channelId), isNull(chatAssignments.unassignedAt))),
    db
      .update(chatChannels)
      .set({ status: "open" })
      .where(and(eq(chatChannels.id, channelId), eq(chatChannels.status, "assigned"))),
  ]);
  return getChannelOut(user, channelId);
}

export async function closeChannel(user: SessionUser, channelId: string) {
  const ch = await assertChannelAccess(user, channelId);
  const staff = user.role === "employee" || user.role === "admin";
  if (!staff && ch.status !== "open")
    throw new ApiError(403, "forbidden", "Only staff can close assigned channels");
  const db = await getDb();
  await db
    .update(chatChannels)
    .set({ status: "closed", closedAt: new Date().toISOString() })
    .where(eq(chatChannels.id, channelId));
  return getChannelOut(user, channelId);
}

export async function chatStats(db: Database) {
  const rows = await db
    .select({ status: chatChannels.status, n: sql<number>`COUNT(*)` })
    .from(chatChannels)
    .groupBy(chatChannels.status);
  const map: Record<string, number> = { open: 0, assigned: 0, closed: 0 };
  for (const r of rows) map[r.status] = Number(r.n);
  return map;
}
