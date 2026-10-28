/**
 * Chat service — port of `chat_service.rs` and `routes/chat.rs`: D1-backed
 * support channels, the durable source of truth behind the `/ws` hub.
 *
 * The writes (message insert, assignment rows, closing) live in
 * `lib/chat/ops.ts` and are shared with the ChatHub Durable Object, which
 * owns live presence and fan-out; this layer authorises, validates, shapes
 * the DTOs and tells the hub what happened (`chat-hub-bridge.ts`).
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getD1, getDb, type Database } from "@/lib/db/client";
import { brands, chatAssignments, chatChannels, chatMessages, users } from "@/lib/db/schema";
import { ApiError, isAdmin, isStaff } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import {
  addMember,
  clearUnread,
  closeChannelRow,
  findMessageByClientId,
  insertMessage,
  MAX_CONTENT_CHARS,
  releaseAssignment,
  upsertAssignment,
  type MessageRow,
} from "@/lib/chat/ops";
import { badRequest, forbidden, notFound } from "@/lib/services/http-errors";
import { emitChatEvent, hubBrowse, hubDeliver, hubRoute } from "@/lib/services/chat-hub-bridge";

type ChannelRow = typeof chatChannels.$inferSelect;
type MessageDbRow = typeof chatMessages.$inferSelect;

const DEFAULT_TOPIC = "Hỗ trợ";
/** The NullClaw bot's well-known account (Rust `NULLCLAW_BOT_EMAIL`); it joins every channel's roster. */
const NULLCLAW_BOT_EMAIL = "nullclaw_agent@example.com";
const MAX_PAGE = 200;

/** `ChannelUserOut`: absent fields are omitted. */
export interface ChannelUserOut {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
}

export interface ChatChannelOut {
  id: string;
  userId: string;
  topic?: string;
  status: string;
  brandId?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadUser: number;
  unreadEmployee: number;
  createdAt: string;
  user?: ChannelUserOut;
  assignedTo?: ChannelUserOut;
  assignedToMe: boolean;
}

export interface ChatMessageOut {
  id: string;
  channelId: string;
  senderType: string;
  senderId?: string;
  content?: string;
  kind: string;
  attachments?: string;
  createdAt: string;
}

/** Rust `is_employee`: any role other than plain user. */
export const isEmployee = (user: SessionUser): boolean => isStaff(user);

// ── DTO mapping ─────────────────────────────────────────────────

type UserCols = Pick<
  typeof users.$inferSelect,
  "id" | "fullName" | "email" | "phone" | "avatarUrl"
>;

function channelUser(u: UserCols): ChannelUserOut {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    ...(u.phone && { phone: u.phone }),
    ...(u.avatarUrl && { avatarUrl: u.avatarUrl }),
  };
}

function channelOut(
  c: ChannelRow,
  user: UserCols | undefined,
  assignedTo: UserCols | undefined,
  assignedToMe: boolean,
): ChatChannelOut {
  return {
    id: c.id,
    userId: c.userId,
    ...(c.topic !== null && { topic: c.topic }),
    status: c.status,
    ...(c.brandId && { brandId: c.brandId }),
    ...(c.lastMessageAt !== null && { lastMessageAt: c.lastMessageAt }),
    ...(c.lastMessagePreview !== null && { lastMessagePreview: c.lastMessagePreview }),
    unreadUser: c.unreadUser,
    unreadEmployee: c.unreadEmployee,
    createdAt: c.createdAt,
    ...(user && { user: channelUser(user) }),
    ...(assignedTo && { assignedTo: channelUser(assignedTo) }),
    assignedToMe,
  };
}

export function messageOut(m: MessageDbRow): ChatMessageOut {
  return {
    id: m.id,
    channelId: m.channelId,
    senderType: m.senderType,
    ...(m.senderId !== null && { senderId: m.senderId }),
    ...(m.content !== null && { content: m.content }),
    kind: m.kind,
    ...(m.attachments !== null && { attachments: m.attachments }),
    createdAt: m.createdAt,
  };
}

/** A message as `ops.ts` returns it (snake-case D1 columns). */
const storedOut = (m: MessageRow): ChatMessageOut =>
  messageOut({
    id: m.id,
    channelId: m.channel_id,
    senderType: m.sender_type,
    senderId: m.sender_id,
    content: m.content,
    kind: m.kind,
    attachments: m.attachments,
    status: m.status,
    clientMsgId: m.client_msg_id,
    createdAt: m.created_at,
  });

/** Customer + active assignee of every channel in one round trip each (no N+1). */
async function toDtos(
  db: Database,
  viewerId: string,
  channels: ChannelRow[],
): Promise<ChatChannelOut[]> {
  if (channels.length === 0) return [];
  const assignments = await db
    .select()
    .from(chatAssignments)
    .where(
      and(
        inArray(
          chatAssignments.channelId,
          channels.map((c) => c.id),
        ),
        isNull(chatAssignments.unassignedAt),
      ),
    );
  const byChannel = new Map(assignments.map((a) => [a.channelId, a]));
  const wanted = new Set([
    ...channels.map((c) => c.userId),
    ...assignments.flatMap((a) => (a.employeeId ? [a.employeeId] : [])),
  ]);
  const people = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(inArray(users.id, [...wanted]));
  const byId = new Map(people.map((u) => [u.id, u]));
  return channels.map((c) => {
    const assigneeId = byChannel.get(c.id)?.employeeId ?? null;
    return channelOut(
      c,
      byId.get(c.userId),
      assigneeId ? byId.get(assigneeId) : undefined,
      assigneeId === viewerId,
    );
  });
}

// ── Access ──────────────────────────────────────────────────────

/**
 * BOLA defence: the channel owner or any staff member. A stranger gets 404,
 * not 403, so a channel's existence is not revealed.
 */
export async function assertChannelAccess(
  user: SessionUser,
  channelId: string,
): Promise<ChannelRow> {
  const db = await getDb();
  const channel = (
    await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1)
  )[0];
  if (!channel || (channel.userId !== user.id && !isEmployee(user)))
    throw notFound("chat channel not found");
  return channel;
}

async function channelDto(viewerId: string, channelId: string): Promise<ChatChannelOut> {
  const db = await getDb();
  const channel = (
    await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1)
  )[0];
  if (!channel) throw notFound("chat channel not found");
  return (await toDtos(db, viewerId, [channel]))[0]!;
}

// ── Channels ────────────────────────────────────────────────────

const lastActivity = desc(chatChannels.lastMessageAt);

/**
 * Customers see their own channels; staff see the whole queue (open and
 * assigned), narrowed to their brand when they have one. Newest activity
 * first; a channel nobody has written in yet sorts last.
 */
export async function listChannels(
  user: SessionUser,
  limit: number,
  offset: number,
): Promise<ChatChannelOut[]> {
  const db = await getDb();
  const where = isEmployee(user)
    ? and(
        inArray(chatChannels.status, ["open", "assigned"]),
        user.brandId ? eq(chatChannels.brandId, user.brandId) : undefined,
      )
    : eq(chatChannels.userId, user.id);
  const rows = await db
    .select()
    .from(chatChannels)
    .where(where)
    .orderBy(lastActivity)
    .limit(Math.min(limit, MAX_PAGE))
    .offset(offset);
  return toDtos(db, user.id, rows);
}

/** A user's own channels, most recently active first (Rust `ChatStore::list_channels`). */
export async function listChannelsOf(userId: string, limit: number): Promise<ChannelRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.userId, userId))
    .orderBy(lastActivity)
    .limit(limit);
}

/** `GET /api/chat/channels/online`: the queue's channels whose customer has a socket open now. */
export async function onlineChannels(user: SessionUser) {
  if (!isStaff(user)) throw forbidden("only staff see who is online");
  const { seq, userIds } = await hubBrowse();
  const db = await getDb();
  const rows: ChannelRow[] = [];
  // Chunked so a busy evening never builds one huge IN list (D1 caps bound parameters).
  for (let i = 0; i < userIds.length; i += 90) {
    rows.push(
      ...(await db
        .select()
        .from(chatChannels)
        .where(
          and(
            inArray(chatChannels.status, ["open", "assigned"]),
            inArray(chatChannels.userId, userIds.slice(i, i + 90)),
            user.brandId ? eq(chatChannels.brandId, user.brandId) : undefined,
          ),
        )),
    );
  }
  rows.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  return { seq, userIds, items: await toDtos(db, user.id, rows) };
}

/** The bot and the system admin join every new channel's roster (best effort, like Rust). */
async function memberRoster(db: Database): Promise<{ botId?: string; adminId?: string }> {
  const [bot, admin] = await Promise.all([
    db.select({ id: users.id }).from(users).where(eq(users.email, NULLCLAW_BOT_EMAIL)).limit(1),
    db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, ["admin", "employee"]), eq(users.isBot, false)))
      .orderBy(users.createdAt)
      .limit(1),
  ]);
  return { botId: bot[0]?.id, adminId: admin[0]?.id };
}

export interface CreateChannelBody {
  topic?: string | null;
  brandId?: string | null;
}

/**
 * Rust `create_channel`: a customer has at most one OPEN channel per brand,
 * so asking again returns it. A new channel joins the customer, the bot and
 * the system admin, and is routed to the most available staff member at once.
 */
export async function createChannel(
  userId: string,
  body: CreateChannelBody,
): Promise<ChatChannelOut> {
  const db = await getDb();
  const brandId = body.brandId ?? null;
  const exists = (
    await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (!exists)
    throw new ApiError(401, "unauthorized", "authentication token references a non-existent user");
  if (brandId) {
    const brand = (
      await db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).limit(1)
    )[0];
    if (!brand) throw badRequest(`brand not found: ${brandId}`);
  }

  const open = (await listChannelsOf(userId, 50)).find(
    (c) => c.status === "open" && c.brandId === brandId,
  );
  if (open) return channelDto(userId, open.id);

  const id = crypto.randomUUID();
  await db.insert(chatChannels).values({
    id,
    userId,
    brandId,
    topic: body.topic ?? DEFAULT_TOPIC,
    status: "open",
    priority: "normal",
  });

  const d1 = await getD1();
  const roster = await memberRoster(db);
  await addMember(d1, id, userId, "user");
  if (roster.botId) await addMember(d1, id, roster.botId, "bot");
  if (roster.adminId) await addMember(d1, id, roster.adminId, "employee");

  // Creation-time assignment: the queue shows an owner before the customer types.
  const routed = await hubRoute(id);
  if (routed?.kind === "assigned") await addMember(d1, id, routed.employeeId, "employee");
  await emitChatEvent({ type: "channel_created", channelId: id, userId }, "all");
  return channelDto(userId, id);
}

// ── Messages ────────────────────────────────────────────────────

export async function listMessages(
  user: SessionUser,
  channelId: string,
  limit: number,
  offset: number,
): Promise<ChatMessageOut[]> {
  await assertChannelAccess(user, channelId);
  const db = await getDb();
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.channelId, channelId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(Math.min(limit, MAX_PAGE))
    .offset(offset);
  return rows.map(messageOut);
}

export interface PostMessageBody {
  content?: string | null;
  kind?: string;
  attachments?: string | null;
  clientMsgId?: string | null;
}

const chars = (s: string): number => [...s].length;

/** `CreateMessageRequest`'s `validator` rules. */
export function validatePostMessage(b: PostMessageBody): void {
  if (typeof b !== "object" || b === null) throw badRequest("invalid request body");
  if (b.content != null && (typeof b.content !== "string" || chars(b.content) > MAX_CONTENT_CHARS))
    throw badRequest("content has an invalid length");
  if (b.kind != null && (typeof b.kind !== "string" || chars(b.kind) > 20))
    throw badRequest("kind has an invalid length");
  if (b.attachments != null && (typeof b.attachments !== "string" || chars(b.attachments) > 16384))
    throw badRequest("attachments has an invalid length");
  if (b.clientMsgId != null && (typeof b.clientMsgId !== "string" || chars(b.clientMsgId) > 100))
    throw badRequest("clientMsgId has an invalid length");
}

/**
 * Rust `post_message`: idempotent per `clientMsgId`, stored, then fanned out
 * to the channel room and — for a customer — routed to staff. The stored
 * message is answered even if the hub is unreachable.
 */
export async function postMessage(
  user: SessionUser,
  channelId: string,
  body: PostMessageBody,
): Promise<ChatMessageOut> {
  validatePostMessage(body);
  await assertChannelAccess(user, channelId);
  const d1 = await getD1();
  const clientMsgId = body.clientMsgId || null;

  if (clientMsgId) {
    const stored = await findMessageByClientId(d1, channelId, clientMsgId);
    if (stored) return storedOut(stored);
  }

  const senderType = isEmployee(user) ? "employee" : "user";
  let stored: MessageRow;
  try {
    stored = await insertMessage(d1, {
      channelId,
      senderType,
      senderId: user.id,
      content: body.content ?? null,
      kind: body.kind ?? "text",
      attachments: body.attachments ?? null,
      clientMsgId,
    });
  } catch (e) {
    // Two sends of one clientMsgId raced: the other won, answer with its row.
    const winner = clientMsgId ? await findMessageByClientId(d1, channelId, clientMsgId) : null;
    if (winner) return storedOut(winner);
    throw e;
  }
  await hubDeliver({
    id: stored.id,
    channelId,
    senderType,
    senderId: user.id,
    senderName: user.fullName,
    text: stored.content ?? "",
    createdAt: stored.created_at,
  });
  return storedOut(stored);
}

export async function markRead(user: SessionUser, channelId: string) {
  await assertChannelAccess(user, channelId);
  await clearUnread(await getD1(), channelId, isEmployee(user) ? "employee" : "user");
  return { ok: true };
}

// ── Assignment actions ──────────────────────────────────────────

/** Tell the staff dashboards a channel changed (Rust `broadcast_channel_update`). */
async function announce(channelId: string, status: string, event: Record<string, unknown>) {
  await emitChatEvent({ ...event, channelId }, "room");
  await emitChatEvent({ type: "channels_changed", channelId, status }, "staff");
}

/**
 * Rust `claim_channel`: staff take over a channel, replacing any assignee.
 * An admin never carries an assignment row: they already own the whole queue.
 */
export async function claimChannel(staff: SessionUser, channelId: string) {
  if (!isStaff(staff)) throw forbidden("only staff may claim channels");
  await assertChannelAccess(staff, channelId);
  const d1 = await getD1();
  if (isAdmin(staff)) await releaseAssignment(d1, channelId);
  else await upsertAssignment(d1, channelId, staff.id);
  const status = isAdmin(staff) ? "open" : "assigned";
  await announce(channelId, status, {
    type: "channel_assigned",
    employeeId: staff.id,
    employeeName: staff.fullName,
    role: isAdmin(staff) ? "admin" : "employee",
    status,
  });
  return { ok: true, channel: await channelDto(staff.id, channelId) };
}

/** Rust `release_channel`: admins only; an employee stays on a channel until an admin moves them. */
export async function releaseChannel(requester: SessionUser, channelId: string) {
  await assertChannelAccess(requester, channelId);
  if (!isAdmin(requester))
    throw forbidden("employees cannot leave an assigned channel — ask an admin to reassign it");
  await releaseAssignment(await getD1(), channelId);
  await announce(channelId, "open", { type: "channel_released", status: "open" });
  return { ok: true, channel: await channelDto(requester.id, channelId) };
}

/** Rust `close_channel_as_staff`: any staff member may close; the assignment ends with it. */
export async function closeChannel(requester: SessionUser, channelId: string) {
  if (!isStaff(requester)) throw forbidden("only staff may close channels");
  await assertChannelAccess(requester, channelId);
  await closeChannelRow(await getD1(), channelId);
  await announce(channelId, "closed", { type: "channel_closed", status: "closed" });
  return { ok: true, channel: await channelDto(requester.id, channelId) };
}

// ── Admin counters ──────────────────────────────────────────────

export async function chatStats(db: Database) {
  const rows = await db
    .select({ status: chatChannels.status, n: sql<number>`COUNT(*)` })
    .from(chatChannels)
    .groupBy(chatChannels.status);
  const map: Record<string, number> = { open: 0, assigned: 0, closed: 0 };
  for (const r of rows) map[r.status] = Number(r.n);
  return map;
}
