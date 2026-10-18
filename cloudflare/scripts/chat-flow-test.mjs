/**
 * Full chat WS flow: staff opens WS → creates channel as customer via REST
 * → staff joins the room → customer sends a message over WS → staff receives
 * the `message` broadcast → channel preview updated in D1.
 */
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_EMAIL ?? "admin@example.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "change-me";

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`);
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const user = (await res.json()).user;
  return { cookies, user };
}

async function main() {
  const { WebSocket } = await import("ws");
  const admin = await login(TEST_EMAIL, TEST_PASSWORD);
  // Register a fresh customer for this run (idempotent on email).
  const email = `smoke-${Date.now()}@test.vn`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Smoke-Test-123!", fullName: "Smoke Tester", locale: "vi" }),
  });
  if (!reg.ok) throw new Error(`register failed: ${reg.status}`);
  const customer = await login(email, "Smoke-Test-123!");
  console.log("admin:", admin.user.name, "| customer:", customer.user.name);

  // Customer creates a support channel (same call the SPA widget makes).
  const chRes = await fetch(`${BASE}/api/chat/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: customer.cookies },
    body: JSON.stringify({ topic: "ws smoke test" }),
  });
  if (!chRes.ok && chRes.status !== 409)
    throw new Error(`channel create failed: ${chRes.status} ${await chRes.text()}`);
  const ch = chRes.ok ? await chRes.json() : await (await fetch(`${BASE}/api/chat/channels`, { headers: { cookie: customer.cookies } })).json();
  const channelId = ch.channel?.id ?? ch.id;
  console.log("channel:", channelId);

  // Staff opens the shared socket and joins the room.
  const staffWs = new WebSocket("ws://localhost:3000/ws", { headers: { cookie: admin.cookies } });
  const customerWs = new WebSocket("ws://localhost:3000/ws", { headers: { cookie: customer.cookies } });

  const staffFrames = [];
  const customerFrames = [];
  staffWs.on("message", (r) => staffFrames.push(JSON.parse(String(r))));
  customerWs.on("message", (r) => customerFrames.push(JSON.parse(String(r))));

  await new Promise((r) => staffWs.once("open", r));
  await new Promise((r) => customerWs.once("open", r));
  await new Promise((r) => setTimeout(r, 300));

  // Both join the channel room.
  staffWs.send(JSON.stringify({ type: "join", channelId }));
  customerWs.send(JSON.stringify({ type: "join", channelId }));
  await new Promise((r) => setTimeout(r, 400));

  // Customer sends a chat message over WS (the SPA's fast path).
  const clientMsgId = `smoke-${Date.now()}`;
  customerWs.send(JSON.stringify({ type: "message", channelId, text: "Xin chào, đây là WS smoke test", clientMsgId }));

  await new Promise((r) => setTimeout(r, 900));

  const staffGot = staffFrames.find((f) => f.type === "message");
  const customerGot = customerFrames.find((f) => f.type === "message");
  console.log("staff received message frame:", !!staffGot, staffGot ? JSON.stringify(staffGot).slice(0, 140) : "");
  console.log("customer echo:", !!customerGot);

  // Typing indicator relay.
  customerWs.send(JSON.stringify({ type: "typing", channelId, isTyping: true }));
  await new Promise((r) => setTimeout(r, 400));
  const typingFrame = staffFrames.find((f) => f.type === "typing");
  console.log("staff got typing:", !!typingFrame, typingFrame ? JSON.stringify(typingFrame) : "");

  // Message persisted? (idempotent replay via REST with the same clientMsgId)
  const replay = await fetch(`${BASE}/api/chat/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: customer.cookies },
    body: JSON.stringify({ content: "Xin chào, đây là WS smoke test", clientMsgId }),
  });
  const replayBody = await replay.json();
  const list = await (await fetch(`${BASE}/api/chat/channels/${channelId}/messages`, { headers: { cookie: customer.cookies } })).json();
  const dupes = list.items.filter((m) => m.content === "Xin chào, đây là WS smoke test").length;
  console.log("persisted messages with the smoke content:", dupes, "(expect 1 — WS insert + REST replay deduped)");

  staffWs.close();
  customerWs.close();

  const pass = staffGot && typingFrame && dupes === 1;
  console.log(pass ? "CHAT FLOW PASS" : "CHAT FLOW INCOMPLETE");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
