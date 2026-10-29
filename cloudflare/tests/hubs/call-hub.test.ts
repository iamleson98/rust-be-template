import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "@/lib/auth/jwt";
import { createUser, migrateAuth, resetAccounts } from "../helpers/auth";
import { connect, is, open, type Client } from "./socket";

/**
 * The `/ws-call` signalling relay, driven the way the Flutter app
 * (`call_signaling.dart`) and the web widget drive it: a staff "phone"
 * registers as an agent with the token in the query string, a customer calls,
 * both exchange SDP / ICE through the Durable Object. This is the hub that
 * every cross-network call goes through.
 */

beforeAll(migrateAuth);

const sockets: Client[] = [];
// Each test gets a hub of its own (production has a single one, but its state is per instance).
let room = "";
beforeEach(() => {
  room = crypto.randomUUID();
});
afterEach(async () => {
  for (const c of sockets.splice(0)) c.close();
  // Let the hub run its close handlers before the next test (or the teardown) starts.
  await new Promise((r) => setTimeout(r, 50));
});

async function who(role: "employee" | "user", fullName: string) {
  const { id } = await createUser({ role, fullName });
  return { id, token: await signAccessToken(id) };
}

async function socket(token: string, headers?: Record<string, string>): Promise<Client> {
  const c = open(await connect("CALL_HUB", token, { headers, room }));
  sockets.push(c);
  return c;
}

/** The phone: registers exactly as `CallSignalingService._onStatus` does. */
async function phone(agent: { id: string; token: string }, extra: Record<string, unknown> = {}) {
  const c = await socket(agent.token);
  c.send({ type: "register", role: "agent", userId: agent.id, channelId: null, ...extra });
  const registered = await c.next(is("registered"));
  return { c, registered };
}

const SDP = { type: "offer", sdp: "v=0 test-offer" };
const ANSWER = { type: "answer", sdp: "v=0 test-answer" };
const CANDIDATE = { candidate: "candidate:1 1 udp 1 10.0.0.1 5000 typ host", sdpMid: "0" };

beforeAll(resetAccounts);

describe("registering", () => {
  it("hands the phone its ICE servers, with STUN at least, and never trusts the client's userId", async () => {
    const agent = await who("employee", "Lan");
    const { registered } = await phone(agent);

    expect(registered).toMatchObject({ role: "agent", userId: agent.id, activeCall: null });
    const servers = registered.iceServers as { urls: string[] }[];
    expect(servers.length).toBeGreaterThan(0);
    for (const s of servers) expect(s.urls.length).toBeGreaterThan(0);
    expect(registered.onlineAgents).toBe(1);
  });

  it("refuses a customer who asks to be an agent", async () => {
    const customer = await who("user", "Khách");
    const c = await socket(customer.token);
    c.send({ type: "register", role: "agent", userId: customer.id });
    expect(await c.next(is("error"))).toMatchObject({ code: "bad-register" });
  });

  it("closes the upgrade for a bad or missing token", async () => {
    expect(await connect("CALL_HUB", "not-a-jwt")).toEqual({ refused: 401 });
    expect(await connect("CALL_HUB", "")).toEqual({ refused: 401 });
  });

  it("accepts the Bearer header as well as the query string", async () => {
    const agent = await who("employee", "Header");
    const c = open(await connect("CALL_HUB", agent.token, { query: false, room }));
    sockets.push(c);
    c.send({ type: "register", role: "agent" });
    expect(await c.next(is("registered"))).toMatchObject({ userId: agent.id });
  });
});

describe("heartbeats", () => {
  it("answers the app's heartbeat (with its timestamp) so the half-open watchdog stays quiet", async () => {
    const agent = await who("employee", "Beat");
    const { c } = await phone(agent);
    // The Flutter client sends `{type: heartbeat, __client_ts}` every 20 s and
    // reconnects if no frame at all arrives for 50 s.
    c.send({ type: "heartbeat", __client_ts: Date.now() });
    expect(await c.next(is("pong"))).toEqual({ type: "pong" });
  });

  it("answers the web client's bare heartbeat too", async () => {
    const agent = await who("employee", "BareBeat");
    const { c } = await phone(agent);
    c.ws.send('{"type":"heartbeat"}');
    expect(await c.next(is("pong"))).toEqual({ type: "pong" });
  });
});

describe("a customer calls the phone", () => {
  it("rings it with the caller's verified name, then relays answer, ICE and hang-up", async () => {
    const agent = await who("employee", "Hùng");
    const customer = await who("user", "Nguyễn Văn Khách");
    const { c: pho } = await phone(agent);
    const cust = await socket(customer.token, { "x-call-country": "VN" });
    cust.send({ type: "register", role: "customer", userId: "someone-else" });
    await cust.next(is("registered"));

    cust.send({ type: "call", to: "agent", kind: "offer", sdp: SDP, channelId: "ch-1" });
    const incoming = await pho.next(is("incoming"));
    expect(incoming).toMatchObject({
      from: customer.id,
      callerName: "Nguyễn Văn Khách",
      channelId: "ch-1",
      kind: "offer",
      sdp: SDP,
    });

    // The phone answers, addressing the customer by the id it learned.
    pho.send({ type: "call", to: customer.id, kind: "answer", sdp: ANSWER });
    expect(await cust.next(is("answer"))).toMatchObject({ from: agent.id, sdp: ANSWER });

    // Trickle ICE flows both ways.
    pho.send({ type: "call", to: customer.id, kind: "ice", candidate: CANDIDATE });
    expect(await cust.next(is("ice"))).toMatchObject({ from: agent.id, candidate: CANDIDATE });
    cust.send({ type: "call", to: "agent", kind: "ice", candidate: CANDIDATE });
    expect(await pho.next(is("ice"))).toMatchObject({ from: customer.id, candidate: CANDIDATE });

    // The media path died (Wi-Fi → LTE): the offerer re-offers, the answerer re-answers.
    cust.send({ type: "call", to: "agent", kind: "offer", iceRestart: true, sdp: SDP });
    expect(await pho.next(is("renegotiate"))).toMatchObject({
      from: customer.id,
      kind: "offer",
      sdp: SDP,
    });
    pho.send({ type: "call", to: customer.id, kind: "answer", iceRestart: true, sdp: ANSWER });
    expect(await cust.next(is("renegotiate"))).toMatchObject({ kind: "answer", sdp: ANSWER });

    pho.send({ type: "hangup", to: customer.id, reason: "remote" });
    expect(await cust.next(is("hangup"))).toMatchObject({ from: agent.id });
  });

  it("tells the customer when no agent is online", async () => {
    const customer = await who("user", "Alone");
    const cust = await socket(customer.token);
    cust.send({ type: "register", role: "customer" });
    await cust.next(is("registered"));
    cust.send({ type: "call", to: "agent", kind: "offer", sdp: SDP });
    expect(await cust.next(is("error"))).toMatchObject({ code: "no-agent" });
  });

  it("lets a phone decline: the customer hears it, and the line is free again", async () => {
    const agent = await who("employee", "Decliner");
    const customer = await who("user", "Declined");
    const { c: pho } = await phone(agent);
    const cust = await socket(customer.token);
    cust.send({ type: "register", role: "customer" });
    await cust.next(is("registered"));

    cust.send({ type: "call", to: "agent", kind: "offer", sdp: SDP });
    await pho.next(is("incoming"));
    pho.send({ type: "hangup", to: customer.id, reason: "declined" });
    expect(await cust.next(is("hangup"))).toMatchObject({ reason: "declined" });
  });

  it("refuses customers calling from outside the allowed countries, staff exempt", async () => {
    const agent = await who("employee", "Abroad");
    const customer = await who("user", "Visitor");
    const blocked = await socket(customer.token, { "x-call-country": "US" });
    expect(await blocked.next(is("error"))).toMatchObject({ code: "region-blocked" });

    const staffAbroad = await socket(agent.token, { "x-call-country": "US" });
    staffAbroad.send({ type: "register", role: "agent" });
    expect(await staffAbroad.next(is("registered"))).toMatchObject({ role: "agent" });
  });
});

describe("the phone dials a customer", () => {
  it("rings the customer's site, and the customer's answer comes back to the phone", async () => {
    const agent = await who("employee", "Caller");
    const customer = await who("user", "Được Gọi");
    const { c: pho } = await phone(agent);
    const cust = await socket(customer.token);
    cust.send({ type: "register", role: "customer" });
    await cust.next(is("registered"));

    // `sendOffer` from the app: `to` is the customer's user id.
    pho.send({ type: "call", to: customer.id, from: agent.id, kind: "offer", sdp: SDP });
    expect(await cust.next(is("incoming"))).toMatchObject({
      from: agent.id,
      callerName: "Caller",
      sdp: SDP,
    });
    cust.send({ type: "call", to: agent.id, kind: "answer", sdp: ANSWER });
    expect(await pho.next(is("answer"))).toMatchObject({ from: customer.id, sdp: ANSWER });
  });

  it("says so when the customer is not online", async () => {
    const agent = await who("employee", "Nobody");
    const { c: pho } = await phone(agent);
    pho.send({ type: "call", to: crypto.randomUUID(), kind: "offer", sdp: SDP });
    expect(await pho.next(is("error"))).toMatchObject({ code: "peer-unavailable" });
  });
});

describe("one agent, two devices", () => {
  it("stops the other device ringing once one answers", async () => {
    const agent = await who("employee", "TwoPhones");
    const customer = await who("user", "Rings Both");
    const { c: a } = await phone(agent);
    const { c: b } = await phone(agent);
    const cust = await socket(customer.token);
    cust.send({ type: "register", role: "customer" });
    await cust.next(is("registered"));

    cust.send({ type: "call", to: "agent", kind: "offer", sdp: SDP });
    await a.next(is("incoming"));
    await b.next(is("incoming"));

    a.send({ type: "call", to: customer.id, kind: "answer", sdp: ANSWER });
    expect(await b.next(is("hangup"))).toMatchObject({ reason: "answered-elsewhere" });
    expect(await cust.next(is("answer"))).toMatchObject({ from: agent.id });
  });
});

describe("a network switch mid-call", () => {
  it("keeps the call when the phone comes back with `resume` inside the grace window", async () => {
    const agent = await who("employee", "Mobile");
    const customer = await who("user", "Waiting");
    const { c: old } = await phone(agent);
    const cust = await socket(customer.token);
    cust.send({ type: "register", role: "customer" });
    await cust.next(is("registered"));
    cust.send({ type: "call", to: "agent", kind: "offer", sdp: SDP });
    await old.next(is("incoming"));
    old.send({ type: "call", to: customer.id, kind: "answer", sdp: ANSWER });
    await cust.next(is("answer"));

    // Wi-Fi → LTE: the old socket vanishes without a hang-up…
    old.close();
    // …and the new one registers with `resume`, as the app does while a call is live.
    const { c: fresh, registered } = await phone(agent, { resume: true });
    expect(registered.activeCall).toEqual({ with: customer.id, state: "active" });

    // The customer is NOT told the call ended, and candidates reach the new socket.
    expect(await cust.silent(is("hangup"), 400)).toBe(true);
    cust.send({ type: "call", to: "agent", kind: "ice", candidate: CANDIDATE });
    expect(await fresh.next(is("ice"))).toMatchObject({ from: customer.id });
    fresh.send({ type: "call", to: customer.id, kind: "ice", candidate: CANDIDATE });
    expect(await cust.next(is("ice"))).toMatchObject({ from: agent.id });
  });

  it("hands a woken phone the ring it missed (the push woke the app, the socket reconnected)", async () => {
    const agent = await who("employee", "Sleeper");
    const customer = await who("user", "Ringing");
    const { c: first } = await phone(agent);
    const cust = await socket(customer.token);
    cust.send({ type: "register", role: "customer" });
    await cust.next(is("registered"));
    cust.send({ type: "call", to: "agent", kind: "offer", sdp: SDP });
    await first.next(is("incoming"));

    // iOS froze the app: nothing reads that socket, yet the server still sees it
    // open (a suspended app sends no FIN), so the ring went into the void. The
    // VoIP push wakes the app, which opens a fresh socket and registers.
    const { c: woken } = await phone(agent);
    expect(await woken.next(is("incoming"))).toMatchObject({ from: customer.id, sdp: SDP });
    woken.send({ type: "call", to: customer.id, kind: "answer", sdp: ANSWER });
    expect(await cust.next(is("answer"))).toMatchObject({ from: agent.id });
  });
});
