/**
 * Chat-bot platform messages — port of `routes/webhooks/shared.rs`: a
 * Zalo / Messenger / Telegram / Discord user becomes a customer account
 * (`<platform>:<id>`), their text lands in an open support channel and the
 * staff are told. The platforms get no automatic reply: Rust's reply hooks
 * only log, and the NullClaw assistant that would answer is off.
 */
import { eq } from "drizzle-orm";
import { getD1, getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { findMessageByClientId, insertMessage } from "@/lib/chat/ops";
import { createChannel, listChannelsOf } from "@/lib/services/chat";
import { hubDeliver } from "@/lib/services/chat-hub-bridge";

export interface PlatformMessage {
  platform: string;
  platformUserId: string;
  userName: string;
  text: string;
  platformMsgId: string | null;
}

/** Find or create the account of a platform user. It has no password, so it cannot log in. */
async function platformUser(platform: string, platformUserId: string, name: string): Promise<string> {
  const db = await getDb();
  const email = `${platform}:${platformUserId}`;
  const existing = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0];
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email, fullName: name, passwordHash: null, role: "user" });
  return id;
}

export async function handlePlatformMessage(msg: PlatformMessage): Promise<void> {
  const userId = await platformUser(msg.platform, msg.platformUserId, msg.userName);

  // Reuse an open channel (any brand); otherwise start one.
  const open = (await listChannelsOf(userId, 50)).find((c) => c.status === "open");
  const channelId =
    open?.id ??
    (await createChannel(userId, { brandId: null, topic: `${msg.platform} - ${msg.userName}` })).id;

  const d1 = await getD1();
  // Platforms retry unanswered calls: the platform message id keeps a retry from storing twice.
  if (msg.platformMsgId && (await findMessageByClientId(d1, channelId, msg.platformMsgId))) return;
  const stored = await insertMessage(d1, {
    channelId,
    senderType: "user",
    senderId: userId,
    content: msg.text,
    clientMsgId: msg.platformMsgId,
  });
  await hubDeliver({
    id: stored.id,
    channelId,
    senderType: "user",
    senderId: userId,
    senderName: msg.userName,
    text: msg.text,
    createdAt: stored.created_at,
  });
}
