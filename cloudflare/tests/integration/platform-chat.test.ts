/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted structurally */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getD1, getDb } from "@/lib/db/client";
import { chatChannels, chatMessages, users } from "@/lib/db/schema";
import { hmacSha256Hex } from "@/lib/webhooks";
import { setCloudflareContext } from "../helpers/context";
import { migrate } from "../helpers/fixture";
import { GET as messengerVerify, POST as messenger } from "@/app/api/webhooks/messenger/route";
import { POST as telegram } from "@/app/api/webhooks/telegram/route";
import { POST as zalo } from "@/app/api/webhooks/zalo/route";
import { POST as discord } from "@/app/api/webhooks/discord/route";

/** The chat-bot platform webhooks (`src/routes/webhooks/*`) from signature to stored message. */

declare global {
  interface Response {
    json(): Promise<any>;
  }
}

const enc = new TextEncoder();
const SECRETS = {
  TELEGRAM_WEBHOOK_SECRET: "tg-secret",
  MESSENGER_APP_SECRET: "fb-secret",
  MESSENGER_VERIFY_TOKEN: "fb-verify",
  ZALO_OA_SECRET: "zalo-secret",
};

beforeAll(migrate);
beforeEach(async () => {
  setCloudflareContext(SECRETS);
  const d1 = await getD1();
  await d1.batch(
    ["chat_message", "chat_assignment", "chat_channel_member", "chat_channel"].map((t) =>
      d1.prepare(`DELETE FROM ${t}`),
    ),
  );
  await d1.prepare(`DELETE FROM "user" WHERE email LIKE '%:%'`).run();
});

const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`https://datxevui.com/api/webhooks/${url}`, { method: "POST", body, headers });
const messages = async () => (await getDb()).select().from(chatMessages);

describe("Telegram", () => {
  const update = (text: string, id = 7) =>
    JSON.stringify({
      update_id: 1,
      message: {
        message_id: id,
        from: { first_name: "An", last_name: "Nguyễn" },
        chat: { id: 555 },
        text,
      },
    });
  const secret = { "x-telegram-bot-api-secret-token": "tg-secret" };

  it("turns a text message into a customer, a channel and a stored message", async () => {
    const res = await telegram(post("telegram", update("Cho mình hỏi vé"), secret));
    expect(await res.json()).toEqual({ status: "ok" });

    const db = await getDb();
    const user = (await db.select().from(users).where(eq(users.email, "telegram:555")))[0]!;
    expect(user).toMatchObject({ fullName: "An Nguyễn", role: "user", passwordHash: null });
    const channel = (
      await db.select().from(chatChannels).where(eq(chatChannels.userId, user.id))
    )[0]!;
    expect(channel).toMatchObject({
      topic: "telegram - An Nguyễn",
      status: "open",
      unreadEmployee: 1,
    });
    expect(await messages()).toMatchObject([
      {
        channelId: channel.id,
        senderType: "user",
        senderId: user.id,
        content: "Cho mình hỏi vé",
        clientMsgId: "tg-7",
      },
    ]);
  });

  it("reuses the account and the open channel, and a retried delivery stores nothing twice", async () => {
    await telegram(post("telegram", update("một", 1), secret));
    await telegram(post("telegram", update("hai", 2), secret));
    await telegram(post("telegram", update("hai", 2), secret)); // the platform retries
    const db = await getDb();
    expect(await db.select().from(chatChannels)).toHaveLength(1);
    expect(await messages()).toHaveLength(2);
  });

  it("401s a wrong or missing secret and 400s a payload it cannot read", async () => {
    expect((await telegram(post("telegram", update("x")))).status).toBe(401);
    expect((await telegram(post("telegram", "{", secret))).status).toBe(400);
    expect(await messages()).toHaveLength(0);
  });

  it("ignores updates without text", async () => {
    const res = await telegram(post("telegram", JSON.stringify({ update_id: 1 }), secret));
    expect(res.status).toBe(200);
    expect(await messages()).toHaveLength(0);
  });
});

describe("Messenger", () => {
  const payload = JSON.stringify({
    entry: [
      {
        messaging: [
          {
            sender: { id: "1234567890123" },
            recipient: { id: "p" },
            message: { mid: "m.1", text: "Xin chào" },
          },
        ],
      },
    ],
  });

  it("answers the subscription handshake with the challenge, or 401 / 400", async () => {
    const url = (q: string) => new Request(`https://datxevui.com/api/webhooks/messenger?${q}`);
    const ok = await messengerVerify(
      url("hub.mode=subscribe&hub.verify_token=fb-verify&hub.challenge=abc123"),
    );
    expect(await ok.text()).toBe("abc123");
    expect(
      (await messengerVerify(url("hub.mode=subscribe&hub.verify_token=bad&hub.challenge=x")))
        .status,
    ).toBe(401);
    expect(
      (
        await messengerVerify(
          url("hub.mode=unsubscribe&hub.verify_token=fb-verify&hub.challenge=x"),
        )
      ).status,
    ).toBe(400);
  });

  it("verifies the body signature and names the customer after the sender id", async () => {
    const sig = `sha256=${await hmacSha256Hex("fb-secret", enc.encode(payload))}`;
    expect(
      (await messenger(post("messenger", payload, { "x-hub-signature-256": sig }))).status,
    ).toBe(200);
    expect(
      (
        await (await getDb()).select().from(users).where(eq(users.email, "messenger:1234567890123"))
      )[0],
    ).toMatchObject({
      fullName: "FB User 12345678",
    });
    expect(
      (await messenger(post("messenger", payload, { "x-hub-signature-256": "sha256=00" }))).status,
    ).toBe(401);
  });
});

describe("Zalo", () => {
  const event = (name: string, extra: object = {}) =>
    JSON.stringify({ event_name: name, timestamp: 1, sender: { id: "z1" }, ...extra });
  const signed = async (body: string) => ({
    "x-zalo-signature": await hmacSha256Hex("zalo-secret", enc.encode(body)),
  });

  it("stores user_send_text under the default name and only acknowledges follow/unfollow", async () => {
    const text = event("user_send_text", { message: { text: "Chào shop", msg_id: "z-9" } });
    expect(await (await zalo(post("zalo", text, await signed(text)))).json()).toEqual({
      status: "ok",
    });
    expect(await messages()).toMatchObject([{ content: "Chào shop", clientMsgId: "z-9" }]);
    const user = (await (await getDb()).select().from(users).where(eq(users.email, "zalo:z1")))[0]!;
    expect(user.fullName).toBe("Khách Zalo");

    const follow = event("follow");
    expect((await zalo(post("zalo", follow, await signed(follow)))).status).toBe(200);
    expect(await messages()).toHaveLength(1);
  });
});

describe("Discord", () => {
  async function signedPost(body: string, tamper = false) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const pk = Array.from(
      new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    setCloudflareContext({ ...SECRETS, DISCORD_PUBLIC_KEY: pk });
    const timestamp = "1700000000";
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, enc.encode(timestamp + body)),
    );
    if (tamper) sig[0] = sig[0]! ^ 1;
    return discord(
      post("discord", body, {
        "x-signature-timestamp": timestamp,
        "x-signature-ed25519": Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join(""),
      }),
    );
  }

  it("answers PING with PONG, forwards command text and acknowledges the rest", async () => {
    expect(await (await signedPost(JSON.stringify({ type: 1 }))).json()).toEqual({ type: 1 });

    const cmd = JSON.stringify({
      type: 2,
      id: "i-1",
      data: { options: [{ name: "message", value: "Giá vé đi Huế?" }] },
      member: { user: { id: "d1", username: "an", global_name: "An D" } },
    });
    const reply = await (await signedPost(cmd)).json();
    expect(reply).toEqual({
      type: 4,
      data: { content: "Tin nhắn của bạn đã được ghi nhận. Nhân viên sẽ phản hồi sớm." },
    });
    expect(await messages()).toMatchObject([{ content: "Giá vé đi Huế?", clientMsgId: "i-1" }]);

    expect(await (await signedPost(JSON.stringify({ type: 3 }))).json()).toEqual({ type: 5 });
  });

  it("401s a forged signature", async () => {
    expect((await signedPost(JSON.stringify({ type: 1 }), true)).status).toBe(401);
  });
});
