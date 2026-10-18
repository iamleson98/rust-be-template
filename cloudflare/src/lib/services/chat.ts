/**
 * Chat service — D1-backed support channels (port of chat_service.rs).
 * Live delivery/presence/audio runs on Cloudflare Realtime meetings keyed
 * by channel; this REST layer is the durable source of truth + fallback.
 */
import { getDb, rawAll, rawBatch, insertSql, type Database } from "@/lib/db/client";
import { chatAssignments, chatChannelMembers, chatChannels, chatMessages, users } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { ApiError } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";

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
  };
  await db.insert(chatChannels).values(ch);
  await db
    .insert(chatChannelMembers)
    .values({ id: crypto.randomUUID(), channelId: id, userId, role: "customer", joinedAt: now })
    .onConflictDoNothing();
  return ch;
}

/** Channels visible to caller: customers see own; staff see open queue (brand-scoped). */
export async function listChannels(user: SessionUser) {
  const db = await getDb();
  if (user.role === "user") {
    return db
      .select({
        id: chatChannels.id,
        topic: chatChannels.topic,
        status: chatChannels.status,
        lastMessageAt: chatChannels.lastMessageAt,
        lastMessagePreview: chatChannels.lastMessagePreview,
        unread: chatChannels.unreadUser,
        createdAt: chatChannels.createdAt,
        customerName: users.fullName,
      })
      .from(chatChannels)
      .innerJoin(users, eq(users.id, chatChannels.userId))
      .where(eq(chatChannels.userId, user.id))
      .orderBy(desc(chatChannels.lastMessageAt), desc(chatChannels.createdAt));
  }
  const rows = await db
    .select({
      id: chatChannels.id,
      topic: chatChannels.topic,
      status: chatChannels.status,
      lastMessageAt: chatChannels.lastMessageAt,
      lastMessagePreview: chatChannels.lastMessagePreview,
      unread: chatChannels.unreadEmployee,
      createdAt: chatChannels.createdAt,
      customerName: users.fullName,
      brandId: chatChannels.brandId,
    })
    .from(chatChannels)
    .innerJoin(users, eq(users.id, chatChannels.userId))
    .orderBy(desc(chatChannels.lastMessageAt), desc(chatChannels.createdAt));
  return user.brandId ? rows.filter((r) => !r.brandId || r.brandId === user.brandId) : rows;
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

export async function listMessages(user: SessionUser, channelId: string, limit = 30, before?: string) {
  await assertChannelAccess(user, channelId);
  const db = await getDb();
  const conds = [eq(chatMessages.channelId, channelId)];
  if (before) conds.push(sql`${chatMessages.createdAt} < ${before}`);
  return db
    .select()
    .from(chatMessages)
    .where(and(...conds))
    .orderBy(desc(chatMessages.createdAt))
    .limit(Math.min(limit, 200));
}

/** Post a message (idempotent per clientMsgId; updates channel preview/unread). */
export async function postMessage(
  user: SessionUser,
  channelId: string,
  body: { text?: string; clientMsgId?: string; kind?: string },
): Promise<typeof chatMessages.$inferSelect> {
  const ch = await assertChannelAccess(user, channelId);
  const db = await getDb();
  const staff = user.role === "employee" || user.role === "admin";
  const senderType = staff ? "employee" : "user";
  const now = new Date().toISOString();
  const text = (body.text ?? "").trim();
  if (!text) throw new ApiError(400, "validation", "text required");
  if (text.length > 4000) throw new ApiError(400, "validation", "text too long");

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
    attachments: null,
    clientMsgId: body.clientMsgId ?? null,
    createdAt: now,
  };
  const unreadCol = sql.raw(staff ? "unread_user" : "unread_employee");
  await rawBatch([
    insertSql("chat_message", {
      id: msg.id,
      channel_id: channelId,
      sender_type: senderType,
      sender_id: user.id,
      content: text,
      kind: msg.kind,
      status: "sent",
      attachments: null,
      client_msg_id: msg.clientMsgId,
      created_at: now,
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
  await rawBatch([
    insertSql("chat_assignment", {
      id: crypto.randomUUID(),
      channel_id: channelId,
      employee_id: user.id,
      assigned_at: now,
      unassigned_at: null,
    }),
    sql`UPDATE chat_channel SET status = 'assigned' WHERE id = ${channelId}`,
    insertSql("chat_channel_member", {
      id: crypto.randomUUID(),
      channel_id: channelId,
      user_id: user.id,
      role: "employee",
      joined_at: now,
      left_at: null,
    }).append(sql` ON CONFLICT DO NOTHING`),
  ]);
  return { ok: true, status: "assigned" };
}

export async function releaseChannel(channelId: string) {
  const db = await getDb();
  const now = new Date().toISOString();
  await rawBatch([
    sql`UPDATE chat_assignment SET unassigned_at = ${now} WHERE channel_id = ${channelId} AND unassigned_at IS NULL`,
    sql`UPDATE chat_channel SET status = 'open' WHERE id = ${channelId} AND status = 'assigned'`,
  ]);
  return { ok: true, status: "open" };
}

export async function closeChannel(user: SessionUser, channelId: string) {
  const ch = await assertChannelAccess(user, channelId);
  const db = await getDb();
  const now = new Date().toISOString();
  const staff = user.role === "employee" || user.role === "admin";
  if (!staff && ch.status !== "open")
    throw new ApiError(403, "forbidden", "Only staff can close assigned channels");
  await db.run(sql`UPDATE chat_channel SET status = 'closed', closed_at = ${now} WHERE id = ${channelId}`);
  return { ok: true, status: "closed" };
}

export async function chatStats(db: Database) {
  const rows = await rawAll<{ status: string; n: number }>(
    sql`SELECT status, COUNT(*) AS n FROM chat_channel GROUP BY status`,
  );
  const map: Record<string, number> = { open: 0, assigned: 0, closed: 0 };
  for (const r of rows) map[r.status] = Number(r.n);
  return map;
}
