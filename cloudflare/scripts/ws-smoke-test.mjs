/**
 * WS smoke test: logs in via REST, opens /ws with the cookie, waits for
 * the `hello` frame, sends `ping`, expects `pong`.
 */
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_EMAIL ?? "admin@example.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "change-me";

async function main() {
  // 1. Login → cookies
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }),
  });
  if (!login.ok) throw new Error(`login failed: ${login.status}`);
  const setCookies = login.headers.getSetCookie?.() ?? [];
  const cookie = setCookies
    .map((c) => c.split(";")[0])
    .filter((c) => c.startsWith("access_token") || c.startsWith("refresh_token"))
    .join("; ");
  console.log("login OK, cookies:", cookie.slice(0, 60), "...");

  // 2. Open the chat WS with the cookie (exactly how the SPA's WsClient does).
  const { WebSocket } = await import("ws");
  const ws = new WebSocket(`ws://localhost:3000/ws`, {
    headers: { cookie },
  });

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout waiting for pong")), 8000);
    ws.on("open", () => console.log("WS OPEN"));
    ws.on("error", (e) => {
      clearTimeout(timeout);
      reject(new Error(`ws error: ${e.message}`));
    });
    ws.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      console.log("FRAME ←", JSON.stringify(frame).slice(0, 120));
      if (frame.type === "hello") {
        ws.send(JSON.stringify({ type: "ping", __client_ts: Date.now() }));
      }
      if (frame.type === "pong") {
        clearTimeout(timeout);
        ws.close();
        resolve("pong received");
      }
    });
  });
  console.log("RESULT:", result);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
