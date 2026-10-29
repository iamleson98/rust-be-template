import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { signAccessToken } from "@/lib/auth/jwt";
import { GET as listChannels, POST as openChannel } from "@/app/api/chat/channels/route";
import { POST as sendMessage } from "@/app/api/chat/channels/[id]/messages/route";
import { createUser, migrateAuth, resetAccounts } from "../helpers/auth";
import { setCloudflareContext } from "../helpers/context";
import { connect, is, open, type Client } from "./socket";

/**
 * The `/ws` chat hub with the Flutter app's traffic (`chat_service.dart`,
 * `api_client.dart`): the phone receives over the socket (`?token=`) and
 * SENDS over REST with `X-Client: mobile`; the customer widget uses the
 * socket's fast path. Every message must reach the other side exactly once,
 * in a form the app's `ChatMessage.fromJson` reads.
 *
 * The REST routes reach the hub through the real `CHAT_HUB` binding, which is
 * the single instance named "global" — so these tests share it and use fresh
 * accounts rather than fresh hubs.
 */

beforeAll(async () => {
  await migrateAuth();
  await resetAccounts();
  setCloudflareContext({ CHAT_HUB: env.CHAT_HUB });
});

const sockets: Client[] = [];
afterEach(async () => {
  for (const c of sockets.splice(0)) c.close();
  // Let the hub run its close handlers before the next test (or the teardown) starts.
  await new Promise((r) => setTimeout(r, 50));
});

async function person(role: "employee" | "user", fullName: string) {
  const { id } = await createUser({ role, fullName });
  return { id, token: await signAccessToken(id) };
}

async function socket(token: string): Promise<Client> {
  const c = open(await connect("CHAT_HUB", token));
  sockets.push(c);
  return c;
}

const asMobile = (token: string, init: RequestInit & { body?: string }) =>
  new Request("https://datxevui.com/api/x", {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-client": "mobile",
      authorization: `Bearer ${token}`,
    },
  });

async function channelOf(customer: { token: string }): Promise<string> {
  const res = await openChannel(asMobile(customer.token, { method: "POST", body: "{}" }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { channel: { id: string } }).channel.id;
}

describe("connecting", () => {
  it("greets the phone with `hello` and refuses a bad token", async () => {
    const staff = await person("employee", "Lan");
    const c = await socket(staff.token);
    expect(await c.next(is("hello"))).toMatchObject({ userId: staff.id, role: "employee" });
    expect(await connect("CHAT_HUB", "garbage")).toEqual({ refused: 401 });
  });

  it("answers the web widget's exact ping with pong (without waking the hub)", async () => {
    const staff = await person("employee", "Pinger");
    const c = await socket(staff.token);
    await c.next(is("hello"));
    c.ws.send('{"type":"ping"}');
    expect(await c.next(is("pong"))).toEqual({ type: "pong" });
  });

  it("tells the phone when a customer comes online", async () => {
    const staff = await person("employee", "Watcher");
    const phone = await socket(staff.token);
    await phone.next(is("hello"));
    const customer = await person("user", "Khách Online");
    await socket(customer.token);
    expect(
      await phone.next((f) => f.type === "customer_presence" && f.userId === customer.id),
    ).toMatchObject({ online: true });
  });
});

describe("text messages", () => {
  it("delivers a message the phone sends by REST to the customer's open socket", async () => {
    const staff = await person("employee", "Hạnh");
    const customer = await person("user", "Minh Khách");
    const channelId = await channelOf(customer);

    const cust = await socket(customer.token);
    cust.send({ type: "join", channelId });
    await cust.next(is("joined"));
    const phone = await socket(staff.token);
    phone.send({ type: "join", channelId });
    await phone.next(is("joined"));

    const clientMsgId = crypto.randomUUID();
    const res = await sendMessage(
      asMobile(staff.token, {
        method: "POST",
        body: JSON.stringify({ content: "Xin chào, em hỗ trợ gì ạ?", kind: "text", clientMsgId }),
      }),
      { params: Promise.resolve({ id: channelId }) },
    );
    expect(res.status).toBe(201);
    const { message } = (await res.json()) as { message: Record<string, unknown> };
    // What `ChatMessage.fromJson` reads from the REST answer (the app puts its own
    // clientMsgId back on it, so the answer need not echo it).
    expect(message).toMatchObject({
      channelId,
      senderType: "employee",
      senderId: staff.id,
      content: "Xin chào, em hỗ trợ gì ạ?",
      kind: "text",
    });

    // The customer hears it once…
    const heard = await cust.next(is("message"));
    expect(heard).toMatchObject({ id: message.id, channelId, text: "Xin chào, em hỗ trợ gì ạ?" });
    expect(await cust.silent(is("message"))).toBe(true);
    // …and the phone's own socket gets the echo with the same id, which
    // `rooms_controller.dart` uses to drop the duplicate of its optimistic bubble.
    expect(await phone.next(is("message"))).toMatchObject({ id: message.id });
  });

  it("notifies the phone in the queue when the customer writes over the socket fast path", async () => {
    const staff = await person("employee", "Ngọc");
    const customer = await person("user", "Thu Khách");
    const channelId = await channelOf(customer);

    const phone = await socket(staff.token); // not joined to the room: only the queue notice reaches it
    await phone.next(is("hello"));
    const cust = await socket(customer.token);
    cust.send({ type: "join", channelId });
    await cust.next(is("joined"));

    cust.send({ type: "message", channelId, text: "Cho mình hỏi giờ xe", clientMsgId: "c-1" });
    // `conversations_controller.dart` patches the row from `preview`.
    expect(await phone.next(is("channel_message"))).toMatchObject({
      channelId,
      senderId: customer.id,
      preview: "Cho mình hỏi giờ xe",
    });
    expect(await cust.next(is("ack"))).toMatchObject({ clientMsgId: "c-1" });
  });

  it("shows the customer's message in the staff queue the phone lists over REST", async () => {
    const staff = await person("employee", "Queue");
    const customer = await person("user", "Queue Khách");
    const channelId = await channelOf(customer);
    const cust = await socket(customer.token);
    cust.send({ type: "join", channelId });
    await cust.next(is("joined"));
    cust.send({ type: "message", channelId, text: "Có ai không?" });
    await cust.next(is("ack"));

    const res = await listChannels(asMobile(staff.token, { method: "GET" }));
    const { items } = (await res.json()) as {
      items: { id: string; lastMessagePreview?: string }[];
    };
    expect(items.find((c) => c.id === channelId)?.lastMessagePreview).toBe("Có ai không?");
  });

  it("is idempotent on clientMsgId: a retry after a lost response stores one message", async () => {
    const staff = await person("employee", "Retry");
    const customer = await person("user", "Retry Khách");
    const channelId = await channelOf(customer);
    const send = () =>
      sendMessage(
        asMobile(staff.token, {
          method: "POST",
          body: JSON.stringify({ content: "một lần thôi", kind: "text", clientMsgId: "same-id" }),
        }),
        { params: Promise.resolve({ id: channelId }) },
      );
    const a = (await (await send()).json()) as { message: { id: string } };
    const b = (await (await send()).json()) as { message: { id: string } };
    expect(b.message.id).toBe(a.message.id);
  });

  it("relays typing to the room, not back to the sender", async () => {
    const staff = await person("employee", "Typer");
    const customer = await person("user", "Typed Khách");
    const channelId = await channelOf(customer);
    const cust = await socket(customer.token);
    cust.send({ type: "join", channelId });
    await cust.next(is("joined"));
    const phone = await socket(staff.token);
    phone.send({ type: "join", channelId });
    await phone.next(is("joined"));

    phone.send({ type: "typing", channelId, isTyping: true });
    expect(await cust.next(is("typing"))).toMatchObject({ userId: staff.id, isTyping: true });
    expect(await phone.silent(is("typing"))).toBe(true);
  });
});
