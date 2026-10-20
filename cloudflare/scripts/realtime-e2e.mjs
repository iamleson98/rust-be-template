/**
 * End-to-end check of the realtime stack against a RUNNING Worker
 * (`wrangler dev` or a deployed preview), driving /ws and /ws-call the way the
 * real clients do:
 *
 *   - a web customer (cookie auth, browser Origin, exact `{"type":"heartbeat"}`)
 *   - a web agent and a MOBILE agent (token in the query string, heartbeat with
 *     a `__client_ts` field, `X-Client: mobile` login)
 *
 * Usage:  BASE=http://localhost:8799 PROMOTE='bunx wrangler d1 execute DB --local --config wrangler.verify.jsonc --command' node scripts/realtime-e2e.mjs
 * `PROMOTE` is any command prefix that runs one SQL statement against the Worker's
 * database; it is used once to make two of the test users employees.
 */
import { execSync } from "node:child_process";
import WebSocket from "ws";

const BASE = process.env.BASE ?? "http://localhost:8799";
const WS = BASE.replace(/^http/, "ws");
const ORIGIN = new URL(BASE).origin;
const PROMOTE = process.env.PROMOTE;
const RUN = Date.now().toString(36);
const PASSWORD = "e2e-password-123";

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function makeUser(label) {
  const email = `${label}-${RUN}@e2e.test`.toLowerCase();
  const reg = await api("/api/auth/register", { fullName: `E2E ${label}`, email, password: PASSWORD });
  if (!reg.res.ok) throw new Error(`register ${label}: ${reg.res.status} ${JSON.stringify(reg.json)}`);
  return { email, label };
}

async function promote(email) {
  if (!PROMOTE) throw new Error("set PROMOTE to a command that runs SQL");
  execSync(`${PROMOTE} "UPDATE \\"user\\" SET role='employee' WHERE email='${email}'"`, { stdio: "ignore" });
}

/** Cookie login, like the browser SPA. */
async function webLogin(email) {
  const { res, json } = await api("/api/auth/login", { email, password: PASSWORD });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { cookie, id: json.user?.id };
}

/** Raw-token login, like the Flutter app (`X-Client: mobile`, employee endpoint). */
async function mobileLogin(email) {
  const { json } = await api("/api/auth/employee-login", { email, password: PASSWORD }, { "x-client": "mobile" });
  return { token: json.tokens?.access_token, id: json.user?.id };
}

class Peer {
  constructor(name, path, opts = {}) {
    this.name = name;
    this.frames = [];
    this.closed = null;
    this.ws = new WebSocket(WS + path, opts);
    this.ws.on("message", (raw) => { const f = JSON.parse(String(raw)); this.frames.push(f); });
    this.ws.on("close", (code) => (this.closed = code));
    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
      this.ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  async waitFor(pred, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = this.frames.find(pred);
      if (hit) return hit;
      await sleep(40);
    }
    return null;
  }
  mark() { return this.frames.length; }
  async since(mark, pred, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = this.frames.slice(mark).find(pred);
      if (hit) return hit;
      await sleep(40);
    }
    return null;
  }
  close() { try { this.ws.close(); } catch {} }
  kill() { try { this.ws.terminate(); } catch {} }
}
const type = (t) => (f) => f.type === t;

async function expectRejected(path, opts, wantStatus) {
  try {
    const p = new Peer("x", path, opts);
    await p.opened;
    p.close();
    return "connected";
  } catch (e) {
    return String(e.message).includes(String(wantStatus)) ? wantStatus : e.message;
  }
}

async function main() {
  console.log(`realtime e2e against ${BASE}\n`);
  const first = await makeUser("owner"); // the first registered user may become admin; keep them out of the way
  const [agentA, agentB, cust, cust2] = await Promise.all(
    ["agentA", "agentB", "cust", "cust2"].map(makeUser),
  );
  await promote(agentA.email);
  await promote(agentB.email);
  void first;

  const custLogin = await webLogin(cust.email);
  const cust2Login = await webLogin(cust2.email);
  const aMobile = await mobileLogin(agentA.email);
  const bWeb = await webLogin(agentB.email);

  // ── Authentication ────────────────────────────────────────────────
  check("mobile employee-login returns raw tokens", !!aMobile.token);
  // A duty-mode phone lives on one socket for hours: its access token (15 min) must be renewable.
  const mobileFull = await api("/api/auth/employee-login", { email: agentA.email, password: PASSWORD }, { "x-client": "mobile" });
  const refreshed = await api("/api/auth/refresh", { refresh_token: mobileFull.json.tokens?.refresh_token }, { "x-client": "mobile" });
  check("mobile refresh with {refresh_token} in the body works", !!refreshed.json.tokens?.access_token, `HTTP ${refreshed.res.status}`);
  const viaRefreshed = await expectRejected(`/ws-call?token=${refreshed.json.tokens?.access_token}`, {}, 0);
  check("the refreshed token opens a call socket", viaRefreshed === "connected");
  check("no credential → 401", (await expectRejected("/ws-call", {}, 401)) === 401);
  check("garbage token → 401", (await expectRejected("/ws-call?token=nope", {}, 401)) === 401);
  check(
    "cookie auth from a foreign Origin is refused (CSWSH)",
    (await expectRejected("/ws-call", { headers: { cookie: custLogin.cookie, origin: "https://evil.example" } }, 403)) === 403,
  );
  check(
    "token auth ignores Origin (mobile / programmatic)",
    (await expectRejected(`/ws-call?token=${aMobile.token}`, { headers: { origin: "https://evil.example" } }, 0)) === "connected",
  );

  // ── Registration, identity and roles ──────────────────────────────
  const agent = new Peer("mobile-agent", `/ws-call?token=${aMobile.token}`);
  await agent.opened;
  agent.send({ type: "register", role: "agent", userId: "SPOOFED-ID", channelId: null });
  const aReg = await agent.waitFor(type("registered"));
  check("agent registers", aReg?.role === "agent");
  check("server uses the JWT identity, not the client's userId", aReg?.userId === aMobile.id, `got ${aReg?.userId}`);
  check("registered frame carries iceServers", Array.isArray(aReg?.iceServers) && aReg.iceServers.length > 0);

  // The mobile app's heartbeat has an extra field the platform auto-response cannot match.
  const mark = agent.mark();
  agent.send({ type: "heartbeat", __client_ts: Date.now() });
  check("mobile-style heartbeat is answered with pong", !!(await agent.since(mark, type("pong"))));
  const mark2 = agent.mark();
  agent.send({ type: "heartbeat" });
  check("web-style heartbeat is answered with pong", !!(await agent.since(mark2, type("pong"))));

  const customer = new Peer("web-customer", "/ws-call", { headers: { cookie: custLogin.cookie, origin: ORIGIN } });
  await customer.opened;
  customer.send({ type: "register", role: "agent", userId: "x" }); // a customer asking to be an agent
  check(
    "a customer cannot register as an agent",
    (await customer.waitFor((f) => f.type === "error" && f.code === "bad-register"))?.code === "bad-register",
  );
  customer.send({ type: "register", role: "customer", channelId: "some-channel" });
  const cReg = await customer.waitFor(type("registered"));
  check("customer registers with their own identity", cReg?.userId === custLogin.id);
  check("customer sees agents available", cReg?.onlineAgents >= 1 && cReg?.agentsAvailable === true);
  check("registering twice on one socket is refused", (customer.send({ type: "register", role: "customer" }), !!(await customer.waitFor((f) => f.code === "already-registered"))));

  // ── A customer calls: the on-duty agent (no channel) rings ────────
  customer.send({ type: "call", to: "agent", kind: "offer", sdp: { type: "offer", sdp: "v=0 offer" } });
  const incoming = await agent.waitFor(type("incoming"));
  check("agent with NO channel receives the customer's call", !!incoming);
  check("incoming carries the customer id, name and offer", incoming?.from === custLogin.id && !!incoming?.callerName && incoming?.sdp?.sdp === "v=0 offer");

  // Only the verified customer can be impersonated by nobody: a stray ICE has no session to go to.
  const stray = new Peer("stray", `/ws-call`, { headers: { cookie: cust2Login.cookie, origin: ORIGIN } });
  await stray.opened;
  stray.send({ type: "register", role: "customer" });
  await stray.waitFor(type("registered"));
  const sMark = agent.mark();
  stray.send({ type: "call", to: aMobile.id, kind: "ice", candidate: { candidate: "x" } });
  await sleep(300);
  check("ICE from someone with no live session reaches nobody", !agent.frames.slice(sMark).some(type("ice")));

  // ── Answer, ICE, ICE restart ───────────────────────────────────────
  agent.send({ type: "call", to: custLogin.id, kind: "answer", sdp: { type: "answer", sdp: "v=0 answer" } });
  const answer = await customer.waitFor(type("answer"));
  check("customer receives the agent's answer", answer?.from === aMobile.id);

  agent.send({ type: "call", to: custLogin.id, kind: "ice", candidate: { candidate: "from-agent" } });
  customer.send({ type: "call", to: "agent", kind: "ice", candidate: { candidate: "from-customer" } });
  check("ICE reaches the customer", !!(await customer.waitFor((f) => f.type === "ice" && f.candidate?.candidate === "from-agent")));
  check("ICE reaches the agent", !!(await agent.waitFor((f) => f.type === "ice" && f.candidate?.candidate === "from-customer")));

  const rMark = agent.mark();
  customer.send({ type: "call", to: "agent", kind: "offer", iceRestart: true, sdp: { type: "offer", sdp: "v=0 restart" } });
  const reneg = await agent.since(rMark, type("renegotiate"));
  check("ICE-restart offer is relayed as renegotiate (not a second ring)", reneg?.kind === "offer" && !agent.frames.slice(rMark).some(type("incoming")));
  const rMark2 = customer.mark();
  agent.send({ type: "call", to: custLogin.id, kind: "answer", iceRestart: true, sdp: { type: "answer", sdp: "v=0 restart-answer" } });
  const reneg2 = await customer.since(rMark2, type("renegotiate"));
  check("ICE-restart answer is relayed as renegotiate", reneg2?.kind === "answer");

  // ── Network switch: the customer's socket dies, a new one resumes ──
  const pMark = agent.mark();
  customer.kill();
  await sleep(500);
  check("peer is NOT hung up the moment a socket drops (resume grace)", !agent.frames.slice(pMark).some(type("hangup")));
  const customer2 = new Peer("web-customer-2", "/ws-call", { headers: { cookie: custLogin.cookie, origin: ORIGIN } });
  await customer2.opened;
  customer2.send({ type: "register", role: "customer", resume: true });
  const resumed = await customer2.waitFor(type("registered"));
  check("a resuming client is told its call is still active", !!resumed?.activeCall);
  await sleep(300);
  check("resumed call survives (no hangup to the agent)", !agent.frames.slice(pMark).some(type("hangup")));
  const iMark = agent.mark();
  customer2.send({ type: "call", to: "agent", kind: "ice", candidate: { candidate: "after-resume" } });
  check("signalling keeps flowing on the new socket", !!(await agent.since(iMark, type("ice"))));

  // ── Team board / chat hub sees the agent on a call ─────────────────
  const chatStaff = new Peer("web-agent-chat", "/ws", { headers: { cookie: bWeb.cookie, origin: ORIGIN } });
  await chatStaff.opened;
  const board = await chatStaff.waitFor((f) => f.type === "staff_presence" && f.staff?.some((s) => s.userId === aMobile.id && s.inCall));
  // The mobile agent is not on /ws in this test, so look at the hub's snapshot after it connects.
  const chatAgent = new Peer("mobile-agent-chat", `/ws?token=${aMobile.token}`);
  await chatAgent.opened;
  const board2 = await chatStaff.waitFor((f) => f.type === "staff_presence" && f.staff?.some((s) => s.userId === aMobile.id && s.inCall === true && s.busy === true));
  check("staff board shows the agent as in-call", !!(board || board2));

  // ── Hangup, then agent-initiated call ──────────────────────────────
  const hMark = agent.mark();
  customer2.send({ type: "hangup", to: "agent", reason: "remote" });
  check("customer hangup reaches the agent", !!(await agent.since(hMark, type("hangup"))));

  const aiMark = customer2.mark();
  agent.send({ type: "call", to: custLogin.id, kind: "offer", sdp: { type: "offer", sdp: "v=0 agent-offer" } });
  const inc2 = await customer2.since(aiMark, type("incoming"));
  check("agent can call the customer back; they see who is calling", inc2?.from === aMobile.id && !!inc2?.callerName);
  customer2.send({ type: "hangup", to: aMobile.id, reason: "declined" });
  await agent.waitFor((f) => f.type === "hangup" && f.reason === "declined");

  // ── Escalation: first agent declines, the second is rung ───────────
  const agentWeb = new Peer("web-agent", "/ws-call", { headers: { cookie: bWeb.cookie, origin: ORIGIN } });
  await agentWeb.opened;
  agentWeb.send({ type: "register", role: "agent" });
  await agentWeb.waitFor(type("registered"));
  const e1 = agent.mark(), e2 = agentWeb.mark();
  customer2.send({ type: "call", to: "agent", kind: "offer", sdp: { type: "offer", sdp: "v=0 esc" } });
  const first1 = await Promise.race([agent.since(e1, type("incoming")), agentWeb.since(e2, type("incoming"))]);
  check("one agent is rung first (not both)", !!first1);
  const ringsFirstAgent = agent.frames.slice(e1).some(type("incoming"));
  const decliner = ringsFirstAgent ? agent : agentWeb;
  const other = ringsFirstAgent ? agentWeb : agent;
  const oMark = other.mark();
  decliner.send({ type: "hangup", to: custLogin.id, reason: "declined" });
  check("a declined ring escalates to the next agent", !!(await other.since(oMark, type("incoming"))));
  other.send({ type: "call", to: custLogin.id, kind: "answer", sdp: { type: "answer", sdp: "v=0" } });
  check("the second agent can answer", !!(await customer2.waitFor((f) => f.type === "answer" && f.from === (ringsFirstAgent ? bWeb.id : aMobile.id))));
  customer2.send({ type: "hangup", to: "agent", reason: "remote" });

  // ── Chat: a customer cannot listen in on someone else's channel ────
  const chatCust = new Peer("chat-customer", "/ws", { headers: { cookie: custLogin.cookie, origin: ORIGIN } });
  await chatCust.opened;
  chatCust.send({ type: "join", channelId: "00000000-0000-4000-8000-000000000999" });
  check("customer cannot join a channel that is not theirs", !!(await chatCust.waitFor((f) => f.type === "error" && /channel/.test(f.message ?? ""))));
  const ch = await (await fetch(BASE + "/api/chat/channels", { method: "POST", headers: { "content-type": "application/json", cookie: custLogin.cookie }, body: "{}" })).json();
  const channelId = ch.channel?.id;
  chatCust.send({ type: "join", channelId });
  check("customer can join their own channel", !!(await chatCust.waitFor((f) => f.type === "joined" && f.channelId === channelId)));
  chatCust.send({ type: "message", channelId, text: "hello from the e2e", clientMsgId: `m-${RUN}` });
  check("customer's message is echoed", !!(await chatCust.waitFor((f) => f.type === "message" && f.text === "hello from the e2e")));
  check("staff are pinged about it", !!(await chatStaff.waitFor((f) => f.type === "channel_message" && f.channelId === channelId)));

  // ── Timers (alarm-driven; slow, so opt in with SLOW=1 and a short ring window) ──
  if (process.env.SLOW) {
    const ringSecs = Number(process.env.RING_SECS ?? 6);
    console.log(`\nslow checks (ring window ${ringSecs}s, resume grace 15s)…`);
    const t1 = agent.mark(), t2 = agentWeb.mark();
    customer2.send({ type: "call", to: "agent", kind: "offer", sdp: { type: "offer", sdp: "v=0 ring" } });
    await sleep(500);
    const firstIsMobile = agent.frames.slice(t1).some(type("incoming"));
    const a1 = firstIsMobile ? agent : agentWeb;
    const a2 = firstIsMobile ? agentWeb : agent;
    const m1 = firstIsMobile ? t1 : t2;
    const m2 = firstIsMobile ? t2 : t1;
    check("first agent is told to stop ringing when the window runs out",
      !!(await a1.since(m1, (f) => f.type === "hangup" && f.reason === "timeout", (ringSecs + 4) * 1000)));
    check("unanswered ring escalates to the next agent on timeout",
      !!(await a2.since(m2, type("incoming"), 3000)));
    const cm = customer2.mark();
    check("customer is told when nobody answered",
      !!(await customer2.since(cm, (f) => f.type === "hangup" && f.reason === "timeout", (ringSecs + 4) * 1000)));

    // Answered call whose caller disappears for good: ended after the grace window.
    const g1 = agent.mark(), g2 = agentWeb.mark();
    customer2.send({ type: "call", to: "agent", kind: "offer", sdp: { type: "offer", sdp: "v=0 grace" } });
    let ringing = null;
    for (let i = 0; i < 50 && !ringing; i++) {
      if (agent.frames.slice(g1).some(type("incoming"))) ringing = agent;
      else if (agentWeb.frames.slice(g2).some(type("incoming"))) ringing = agentWeb;
      else await sleep(100);
    }
    check("the grace-test call rings an agent", !!ringing);
    const am = customer2.mark();
    ringing.send({ type: "call", to: custLogin.id, kind: "answer", sdp: { type: "answer", sdp: "v=0" } });
    check("the grace-test call is answered", !!(await customer2.since(am, type("answer"))));
    const gm = ringing.mark();
    customer2.kill();
    const early = await ringing.since(gm, type("hangup"), 8000);
    check("no hangup inside the grace window", !early, early ? JSON.stringify(early) : "");
    check("hangup (peer-offline) once the grace window expires without a resume",
      !!(await ringing.since(gm, (f) => f.type === "hangup" && f.reason === "peer-offline", 12000)));
  }

  for (const p of [agent, agentWeb, customer2, stray, chatStaff, chatAgent, chatCust]) p.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("e2e crashed:", e);
  process.exit(2);
});
