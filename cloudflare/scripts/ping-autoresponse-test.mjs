// Verifies the ChatHub platform-level ping auto-response: an exact
// `{"type":"ping"}` frame must be answered by workerd WITHOUT waking the
// Durable Object (setWebSocketAutoResponse), while a timestamped ping
// still goes through webSocketMessage (fallback path with __server_ts).
// Usage: node scripts/ping-autoresponse-test.mjs
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_EMAIL ?? "leminhson2398@outlook.co";
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "";

/** Collect every incoming frame into a queue with matchers. */
class FrameQueue {
  constructor(ws) {
    this.pending = [];
    this.waiters = [];
    ws.addEventListener("message", (ev) => {
      let data;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const w = this.waiters.shift();
      if (w) w(data);
      else this.pending.push(data);
    });
  }
  /** Resolve when a frame matching pred arrives (pending frames count). */
  next(pred, label) {
    const hit = this.pending.findIndex(pred);
    if (hit >= 0) return Promise.resolve(this.pending.splice(hit, 1)[0]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting " + label)), 8000);
      this.waiters.push((data) => {
        if (pred(data)) {
          clearTimeout(t);
          resolve(data);
        } else {
          this.pending.push(data);
          // re-register for the next frame
          this.next(pred, label).then(resolve, reject);
        }
      });
    });
  }
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
});
if (!login.ok) throw new Error("login failed " + login.status);
const cookies = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .filter((c) => c.startsWith("access_token="))
  .join("; ");
if (!cookies) throw new Error("no access_token cookie");

const ws = new WebSocket(`ws://localhost:3000/ws`, { headers: { cookie: cookies } });
await new Promise((r, j) => {
  ws.addEventListener("open", r);
  ws.addEventListener("error", () => j(new Error("ws open failed")));
});
const q = new FrameQueue(ws);

// 1. Exact-match ping → platform auto-response `{"type":"pong"}` (no ts).
//    The listener is registered BEFORE the send — the auto-response is
//    immediate and would beat a lazily attached listener.
const exactPong = q.next(
  (d) => d.type === "pong" && d.__server_ts === undefined,
  "exact-match platform pong",
);
ws.send('{"type":"ping"}');
const pong1 = await exactPong;
console.log("PASS exact ping -> platform pong (no __server_ts):", JSON.stringify(pong1));

// 2. Timestamped ping → DO fallback path answers with __server_ts.
const legacyPong = q.next(
  (d) => d.type === "pong" && typeof d.__server_ts === "number",
  "legacy fallback pong",
);
ws.send(JSON.stringify({ type: "ping", __client_ts: Date.now() }));
const pong2 = await legacyPong;
console.log("PASS legacy ping -> fallback pong (with __server_ts)");

ws.close(1000, "done");
console.log("PING AUTO-RESPONSE PASS");
