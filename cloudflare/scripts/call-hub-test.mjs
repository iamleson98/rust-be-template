/**
 * /ws-call smoke test: customer + agent register on a channel; the agent
 * count presence arrives; a call offer relayed as `incoming`.
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
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  const { WebSocket } = await import("ws");
  const adminCookies = await login(TEST_EMAIL, TEST_PASSWORD);

  const agent = new WebSocket("ws://localhost:3000/ws-call", { headers: { cookie: adminCookies } });
  await new Promise((r, j) => { agent.once("open", r); agent.once("error", j); });
  const agentFrames = [];
  agent.on("message", (r) => agentFrames.push(JSON.parse(String(r))));

  agent.send(JSON.stringify({ type: "register", role: "agent", userId: "agent-1", channelId: "ch-test" }));
  await new Promise((r) => setTimeout(r, 400));
  const registered = agentFrames.find((f) => f.type === "registered");
  console.log("registered:", JSON.stringify(registered)?.slice(0, 120));

  // Customer registers on the same channel, then places a call to 'agent'.
  const customer = new WebSocket("ws://localhost:3000/ws-call", { headers: { cookie: adminCookies } });
  await new Promise((r, j) => { customer.once("open", r); customer.once("error", j); });
  customer.send(JSON.stringify({ type: "register", role: "customer", userId: "cust-1", channelId: "ch-test" }));
  await new Promise((r) => setTimeout(r, 300));

  customer.send(
    JSON.stringify({
      type: "call",
      to: "agent",
      from: "cust-1",
      kind: "offer",
      sdp: { type: "offer", sdp: "v=0 fake-offer" },
    }),
  );
  await new Promise((r) => setTimeout(r, 500));

  const incoming = agentFrames.find((f) => f.type === "incoming");
  console.log("agent got incoming call:", !!incoming, incoming ? JSON.stringify(incoming).slice(0, 140) : "");

  // Hangup relay.
  customer.send(JSON.stringify({ type: "hangup", to: "agent", from: "cust-1", reason: "busy" }));
  await new Promise((r) => setTimeout(r, 400));
  const hangup = agentFrames.find((f) => f.type === "hangup");
  console.log("agent got hangup:", !!hangup, hangup ? JSON.stringify(hangup) : "");

  agent.close();
  customer.close();
  const pass = registered && incoming && hangup;
  console.log(pass ? "CALL HUB PASS" : "CALL HUB INCOMPLETE");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
