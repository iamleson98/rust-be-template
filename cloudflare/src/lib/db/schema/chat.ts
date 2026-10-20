/**
 * Chat schema — support channels between customers and staff.
 * Ported from migration _000008_create_chat.
 *
 * On Cloudflare, live delivery + presence + audio calls run on
 * Cloudflare Realtime (RealtimeKit meetings keyed by channel id);
 * D1 remains the durable store + REST fallback path.
 */
import { isoNow } from "./now";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { brands } from "./commerce-brand";

export const chatChannels = sqliteTable(
  "chat_channel",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
    topic: text("topic"),
    status: text("status").notNull().default("open"), // open | assigned | closed
    priority: text("priority").notNull().default("normal"),
    lastMessageAt: text("last_message_at"),
    lastMessagePreview: text("last_message_preview"),
    unreadUser: integer("unread_user").notNull().default(0),
    unreadEmployee: integer("unread_employee").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    closedAt: text("closed_at"),
    /** Cloudflare Realtime meeting id for live chat / audio (migration 0002). */
    realtimeMeetingId: text("realtime_meeting_id"),
  },
  (t) => [index("idx_chat_user").on(t.userId), index("idx_chat_status").on(t.status)],
);

export const chatMessages = sqliteTable(
  "chat_message",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    senderType: text("sender_type").notNull(), // user | employee | assistant | system
    senderId: text("sender_id"),
    content: text("content"),
    kind: text("kind").notNull().default("text"),
    attachments: text("attachments"),
    status: text("status").notNull().default("sent"),
    clientMsgId: text("client_msg_id"),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [
    index("idx_cm_channel_created").on(t.channelId, t.createdAt),
    index("idx_cm_sender").on(t.senderType, t.channelId, t.createdAt),
    uniqueIndex("idx_cm_channel_client").on(t.channelId, t.clientMsgId),
  ],
);

export const chatAssignments = sqliteTable(
  "chat_assignment",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    employeeId: text("employee_id").references(() => users.id, { onDelete: "set null" }),
    assignedAt: text("assigned_at").notNull().$defaultFn(isoNow),
    unassignedAt: text("unassigned_at"),
  },
  (t) => [index("idx_ca_channel").on(t.channelId), index("idx_ca_employee").on(t.employeeId)],
);

export const chatChannelMembers = sqliteTable(
  "chat_channel_member",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    joinedAt: text("joined_at").notNull().$defaultFn(isoNow),
    leftAt: text("left_at"),
  },
  (t) => [
    index("idx_ccm_channel").on(t.channelId),
    index("idx_ccm_user").on(t.userId),
    uniqueIndex("idx_ccm_pair").on(t.channelId, t.userId),
  ],
);

export const nullclawExchanges = sqliteTable(
  "nullclaw_exchange",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").references(() => chatChannels.id, { onDelete: "set null" }),
    userMessageId: text("user_message_id"),
    assistantMessageId: text("assistant_message_id"),
    prompt: text("prompt"),
    completion: text("completion"),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    handoffToHuman: integer("handoff_to_human", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
  },
  (t) => [index("idx_nx_channel").on(t.channelId)],
);
