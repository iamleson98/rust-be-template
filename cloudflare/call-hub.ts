import { DurableObject } from "cloudflare:workers";
import {
  CallSessions,
  type CallRole,
  type CallSession,
  type CallerProfile,
} from "./src/lib/calls/sessions";
import { countryAllowed } from "./src/lib/calls/policy";
import { authenticateWs } from "./src/lib/realtime/ws-auth";
import {
  iceServersFor,
  PUBLIC_ICE_SERVERS,
  type IceServerConfig,
} from "./src/lib/services/turn-credentials";
import { notifyCallEnded, notifyIncomingCall } from "./src/lib/push/notify";

/**
 * CallHub — the WebRTC signalling relay behind `/ws-call` (port of the Rust
 * `audio_call` module). Two peers exchange SDP offers / answers / ICE
 * candidates through this Durable Object; the audio itself flows peer to
 * peer, relayed by Cloudflare TURN when a direct path is blocked (corporate
 * firewalls, symmetric NAT — `turns:` on TCP 443 passes HTTPS-only proxies).
 *
 * Frame protocol (the web SPA's `features/call/audio-call-client.ts` and the
 * mobile app's `call_signaling.dart` both speak it):
 *
 *   client → server : register {role, channelId?, resume?} ·
 *                     call {to, kind: offer|answer|ice, sdp?, candidate?,
 *                           iceRestart?} · hangup {to, reason} · heartbeat
 *   server → client : registered {role, userId, onlineAgents, iceServers,
 *                     activeCall} · ice-servers · presence {onlineAgents,
 *                     agentInCall, agentsAvailable} · incoming · answer · ice ·
 *                     renegotiate · hangup · error {code} · pong
 *
 * What the server decides — never the client:
 *   - WHO a socket is (the verified JWT; a client-supplied `userId` is ignored);
 *   - whether it may be an AGENT (staff only);
 *   - WHICH agent a customer's call rings (online, not already on a call, the
 *     one rung longest ago), escalating to the next on decline / timeout;
 *   - whether a call outlives a dropped socket (15 s grace for a network
 *     switch, then `register {resume}` takes it over).
 *
 * Durable by construction: sockets carry their identity in the WebSocket
 * attachment, and the call sessions live in Durable Object storage. The DO may
 * hibernate (idle sockets cost nothing) or be evicted mid-call and every call
 * is still there when it wakes. Timers (ring timeout, resume grace, maximum
 * call length) are one storage alarm.
 */

interface SocketState {
  /** Unique per socket (one user may hold several: web + phone). */
  connId: string;
  userId: string;
  name: string;
  role: CallRole;
  isStaff: boolean;
  channelId: string | null;
  registered: boolean;
  connectedAt: number;
}

interface Live {
  connId: string;
  ws: WebSocket;
  state: SocketState;
}

/** How long an answered call outlives the drop of the socket carrying it. */
const RESUME_GRACE_MS = 15_000;
const ICE_ROTATION_PUSH_MS = 30 * 60_000;
const MAX_SOCKETS_PER_USER = 8;
/** WebSocket close code for callers outside the allowed countries (clients stop retrying). */
const REGION_BLOCKED_CLOSE = 4403;
const HANGUP_REASONS = new Set(["busy", "declined", "timeout", "mic-denied"]);

export class CallHub extends DurableObject<CloudflareEnv> {
  private sessions = new CallSessions();
  private lastRung = new Map<string, number>();
  private lastIcePushAt = 0;
  private lastChatBridge = "";
  private warnedNoTurn = false;

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    // Heartbeats: the web client's exact frame is answered by the platform
    // without waking this DO. Variants (the mobile app appends a timestamp)
    // fall through to webSocketMessage, which answers them too.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"heartbeat"}', '{"type":"pong"}'),
    );
    ctx.blockConcurrencyWhile(async () => {
      this.sessions = new CallSessions((await ctx.storage.get<CallSession[]>("sessions")) ?? []);
    });
  }

  // ── Configuration ─────────────────────────────────────────────────

  private get ringMs(): number {
    return Math.max(5, Number(this.env.AUDIO_CALL_RING_TIMEOUT_SECS) || 60) * 1000;
  }

  private get maxCallMs(): number {
    return Math.max(60, Number(this.env.AUDIO_CALL_MAX_SECS) || 7200) * 1000;
  }

  // ── Upgrade ───────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/ws-call" || request.headers.get("Upgrade") !== "websocket") {
      return new Response("not found", { status: 404 });
    }
    const auth = await authenticateWs(request, this.env);
    if (!auth.ok) return new Response(auth.reason, { status: auth.status });
    const { user } = auth;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Calls are Vietnam-only for customers (staff are exempt): TURN relays
    // cost money per GB and a call line is an obvious abuse target.
    const country = request.headers.get("x-call-country");
    if (!user.isStaff && !countryAllowed(country, this.env.CALL_ALLOWED_COUNTRIES)) {
      this.ctx.acceptWebSocket(server);
      this.send(server, {
        type: "error",
        code: "region-blocked",
        message: "Calls are only available in Vietnam",
      });
      server.close(REGION_BLOCKED_CLOSE, "region-blocked");
      return new Response(null, { status: 101, webSocket: client });
    }

    if (this.live().filter((s) => s.state.userId === user.id).length >= MAX_SOCKETS_PER_USER) {
      return new Response("too many connections", { status: 429 });
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      connId: crypto.randomUUID(),
      userId: user.id,
      name: user.fullName,
      role: "customer",
      isStaff: user.isStaff,
      channelId: null,
      registered: false,
      connectedAt: Date.now(),
    } satisfies SocketState);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Socket helpers ────────────────────────────────────────────────

  private live(): Live[] {
    const out: Live[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as SocketState | null;
      if (state?.connId) out.push({ connId: state.connId, ws, state });
    }
    return out;
  }

  private registeredSockets(userId: string): Live[] {
    return this.live().filter((s) => s.state.registered && s.state.userId === userId);
  }

  private send(ws: WebSocket, frame: Record<string, unknown>): boolean {
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false; // closed mid-send; its close handler cleans up
    }
  }

  /** Send to every registered socket of a user; false when none took it. */
  private sendUser(userId: string, frame: Record<string, unknown>, exceptConn?: string): boolean {
    let sent = false;
    for (const s of this.registeredSockets(userId)) {
      if (s.connId === exceptConn) continue;
      if (this.send(s.ws, frame)) sent = true;
    }
    return sent;
  }

  private sendError(userId: string, code: string, message: string) {
    this.sendUser(userId, { type: "error", code, message });
  }

  // ── Presence & agent selection ────────────────────────────────────

  private agentIds(): string[] {
    return [
      ...new Set(
        this.live()
          .filter((s) => s.state.registered && s.state.role === "agent")
          .map((s) => s.state.userId),
      ),
    ];
  }

  /** The free agent rung longest ago (spreads calls evenly across the team). */
  private pick = (exclude: ReadonlySet<string>): string | null => {
    const free = this.agentIds().filter((a) => !exclude.has(a));
    free.sort(
      (a, b) => (this.lastRung.get(a) ?? 0) - (this.lastRung.get(b) ?? 0) || (a < b ? -1 : 1),
    );
    return free[0] ?? null;
  };

  private presenceFrame() {
    return {
      type: "presence",
      onlineAgents: this.agentIds().length,
      agentInCall: this.sessions.anyAgentInCall(),
      agentsAvailable: this.pick(this.sessions.busyAgents()) !== null,
    };
  }

  private broadcastPresence() {
    const frame = this.presenceFrame();
    for (const s of this.live()) if (s.state.registered) this.send(s.ws, frame);
    this.bridgeToChat();
  }

  /** Tell the chat hub which staff are on a call, for the team board. */
  private bridgeToChat() {
    const inCall = this.sessions
      .all()
      .filter((s) => s.state === "active")
      .map((s) => s.agentId)
      .sort();
    const key = inCall.join(",");
    if (key === this.lastChatBridge) return;
    this.lastChatBridge = key;
    const ns = this.env.CHAT_HUB;
    if (!ns) return;
    this.ctx.waitUntil(
      ns
        .get(ns.idFromName("global"))
        .fetch("https://chat-hub/call-state", {
          method: "POST",
          body: JSON.stringify({ inCall }),
        })
        .then(() => undefined)
        .catch(() => undefined),
    );
  }

  // ── Persistence & the alarm ───────────────────────────────────────

  private async persist() {
    await this.ctx.storage.put("sessions", this.sessions.snapshot());
    const next = this.sessions.nextDeadline(this.ringMs, this.maxCallMs);
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 250));
  }

  private callerProfile(s: SocketState): CallerProfile {
    return { name: s.name || null, avatar: null };
  }

  // ── Frames ────────────────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (!state) return;
    if (typeof raw !== "string") {
      this.send(ws, { type: "error", code: "binary-unsupported", message: "Text frames only" });
      return;
    }
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.send(ws, { type: "error", code: "bad-json", message: "invalid JSON" });
      return;
    }
    const type = String(frame.type ?? "");

    if (type === "heartbeat") {
      this.send(ws, { type: "pong" });
      return;
    }
    if (type === "register") {
      await this.onRegister(ws, state, frame);
      return;
    }
    if (!state.registered) {
      this.send(ws, {
        type: "error",
        code: "not-registered",
        message: "Send a register message first",
      });
      return;
    }
    if (type === "call") await this.onCall(ws, state, frame);
    else if (type === "hangup") await this.onHangup(state, frame);
    else this.send(ws, { type: "error", message: `unknown message type: ${type}` });
  }

  private async onRegister(ws: WebSocket, state: SocketState, frame: Record<string, unknown>) {
    if (state.registered) {
      this.send(ws, { type: "error", code: "already-registered", message: "Already registered" });
      return;
    }
    const wantsAgent = frame.role === "agent";
    if (wantsAgent && !state.isStaff) {
      this.send(ws, {
        type: "error",
        code: "bad-register",
        message: "Only staff may register as agents",
      });
      return;
    }
    state.role = wantsAgent ? "agent" : "customer";
    state.channelId = typeof frame.channelId === "string" ? frame.channelId : null;
    state.registered = true;
    ws.serializeAttachment(state);

    // Back mid-call (a network switch): this socket takes the call over, so
    // the old socket's late drop no longer ends it.
    if (frame.resume === true && this.sessions.resumeOnSocket(state.userId, state.connId)) {
      await this.persist();
    }

    const mine = this.sessions.ofUser(state.userId);
    const { onlineAgents, agentInCall, agentsAvailable } = this.presenceFrame();
    this.send(ws, {
      type: "registered",
      role: state.role,
      userId: state.userId,
      onlineAgents,
      agentInCall,
      agentsAvailable,
      iceServers: await this.currentIceServers(),
      activeCall: mine
        ? {
            with: mine.customerId === state.userId ? mine.agentId : mine.customerId,
            state: mine.state,
          }
        : null,
    });

    // A phone whose app was frozen missed the original ring; the push woke it,
    // the socket reconnected — hand the still-ringing offer to THIS socket.
    if (state.role === "agent") {
      const ringing = this.sessions.ringingFor(state.userId);
      if (ringing) this.send(ws, this.incomingFrame(ringing, "agent"));
      this.broadcastPresence();
    }
  }

  /** The `incoming` frame for a session, as seen by the callee. */
  private incomingFrame(s: CallSession, to: CallRole) {
    const fromId = to === "agent" ? s.customerId : s.agentId;
    return {
      type: "incoming",
      from: fromId,
      channelId: s.channelId,
      callerName: s.caller.name,
      callerAvatar: s.caller.avatar,
      sdp: s.offer,
      kind: "offer",
    };
  }

  /** Ring the callee of a session (all their devices) and push to sleeping phones. */
  private relayOffer(s: CallSession): boolean {
    const toRole: CallRole = s.initiator === "customer" ? "agent" : "customer";
    const calleeId = toRole === "agent" ? s.agentId : s.customerId;
    const sent = this.sendUser(calleeId, this.incomingFrame(s, toRole));
    if (!sent) {
      // Picked an agent whose socket vanished between pick and send: roll back
      // so the caller is not left ringing a ghost.
      this.sessions.remove(s.customerId);
      this.sendError(
        s.initiator === "customer" ? s.customerId : s.agentId,
        "peer-unavailable",
        "Peer not online or unavailable",
      );
      return false;
    }
    if (toRole === "agent") {
      this.lastRung.set(s.agentId, Date.now());
      // Device push wakes backgrounded phones; the socket ring stays the source of truth.
      this.ctx.waitUntil(
        notifyIncomingCall(this.env, s.agentId, {
          customerId: s.customerId,
          channelId: s.channelId,
          callerName: s.caller.name,
          callerAvatar: s.caller.avatar,
        }),
      );
    }
    return true;
  }

  private async onCall(ws: WebSocket, state: SocketState, frame: Record<string, unknown>) {
    const kind = String(frame.kind ?? "");
    const to = String(frame.to ?? "");
    const uid = state.userId;
    const sdp = frame.sdp;
    const iceRestart = frame.iceRestart === true;
    const now = Date.now();

    // Who is on the other end of OUR live session (the server decides — the
    // client's `to` is only a hint for agents choosing a customer).
    const peer = (): string | null =>
      state.role === "customer" ? this.sessions.agentFor(uid) : this.sessions.agentTarget(uid, to);

    // ICE-restart renegotiation: relayed, never touches session state. This is
    // the recovery path for a media path that died (network switch, strict NAT).
    if ((kind === "offer" || kind === "answer") && iceRestart) {
      const target = peer();
      if (!target) {
        this.sendError(uid, "no-session", "No live call to renegotiate");
        return;
      }
      this.sendUser(target, { type: "renegotiate", from: uid, sdp, kind });
      return;
    }

    switch (kind) {
      case "offer": {
        const channelId =
          typeof frame.channelId === "string" ? frame.channelId : (state.channelId ?? null);
        const caller = this.callerProfile(state);
        if (state.role === "customer") {
          const out = this.sessions.beginCustomerOffer(
            uid,
            sdp,
            channelId,
            state.connId,
            caller,
            this.pick,
            now,
          );
          if (out.kind === "ringing") {
            this.relayOffer(this.sessions.get(uid)!);
          } else if (out.kind === "customer-busy") {
            this.sendError(uid, "customer-busy", "You are already in a call");
          } else if (out.kind === "no-agent") {
            const none = this.agentIds().length === 0;
            this.sendError(
              uid,
              none ? "no-agent" : "agents-busy",
              none
                ? "No agent online right now"
                : "All agents are busy right now — please try again shortly",
            );
          }
        } else {
          if (!to) {
            this.send(ws, { type: "error", message: "Missing `to` field" });
            return;
          }
          const isCustomerOnline = this.registeredSockets(to).some(
            (s) => s.state.role === "customer",
          );
          if (!isCustomerOnline) {
            this.sendError(uid, "peer-unavailable", "Peer not online or invalid");
            return;
          }
          const out = this.sessions.beginAgentOffer(
            uid,
            to,
            sdp,
            channelId,
            state.connId,
            caller,
            now,
          );
          if (out.kind === "ringing") this.relayOffer(this.sessions.get(to)!);
          else if (out.kind === "peer-busy")
            this.sendError(uid, "peer-busy", "Customer is already in a call");
          else if (out.kind === "agent-busy")
            this.sendError(uid, "agent-busy", "You are already in a call");
        }
        await this.persist();
        this.broadcastPresence();
        return;
      }

      case "answer": {
        if (!to) {
          this.send(ws, { type: "error", message: "Missing `to` field" });
          return;
        }
        // The answerer is us; `to` is the offerer. The session is keyed by the
        // customer and pairs the two.
        const [agentId, customerId] = state.role === "agent" ? [uid, to] : [to, uid];
        const answered = this.sessions.onAnswer(agentId, customerId, state.connId, now);
        if (!answered) {
          // Re-routed away, already answered, or no session: a late or
          // duplicate answer must not fabricate a call.
          this.sendError(uid, "no-session", "No ringing call to answer");
          return;
        }
        await this.persist();
        this.sendUser(to, { type: "answer", from: uid, sdp });
        // The answerer's OTHER devices are still ringing — stop them.
        this.sendUser(
          uid,
          { type: "hangup", from: "system", reason: "answered-elsewhere" },
          state.connId,
        );
        this.ctx.waitUntil(notifyCallEnded(this.env, answered.agentId, answered.customerId));
        this.broadcastPresence();
        return;
      }

      case "ice": {
        const target = peer();
        if (target) this.sendUser(target, { type: "ice", from: uid, candidate: frame.candidate });
        return; // no live session: the candidate has nowhere to go
      }

      default:
        this.send(ws, { type: "error", message: `Unknown call kind: ${kind}` });
    }
  }

  private async onHangup(state: SocketState, frame: Record<string, unknown>) {
    const uid = state.userId;
    const reasonRaw = String(frame.reason ?? "");
    const reason = HANGUP_REASONS.has(reasonRaw) ? reasonRaw : "remote";
    const now = Date.now();

    if (state.role === "customer") {
      const out = this.sessions.onCustomerHangup(uid);
      if (out.kind === "notify-agent") {
        this.sendUser(out.agentId, { type: "hangup", from: uid, reason });
        this.ctx.waitUntil(notifyCallEnded(this.env, out.agentId, uid));
      }
    } else {
      this.drainAgent(uid, reason, now, uid);
    }
    await this.persist();
    this.broadcastPresence();
  }

  /**
   * An agent is leaving every session they hold (decline, hang-up, timeout,
   * offline). Ringing customer calls escalate to the next free agent; the rest
   * end and the customer is told why.
   */
  private drainAgent(agentId: string, reason: string, now: number, fromLabel: string) {
    for (let i = 0; i < 100; i++) {
      const out = this.sessions.onAgentHangup(agentId, reason, this.pick, now);
      if (out.kind === "none") return;
      if (out.kind === "rerouted") {
        const s = this.sessions.get(out.customerId);
        if (s) this.relayOffer(s);
        continue;
      }
      this.sendUser(out.customerId, { type: "hangup", from: fromLabel, reason: out.reason });
    }
  }

  // ── Disconnects ───────────────────────────────────────────────────

  async webSocketClose(ws: WebSocket) {
    await this.dropSocket(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.dropSocket(ws);
  }

  private async dropSocket(ws: WebSocket) {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (!state?.registered) return;
    const now = Date.now();
    const uid = state.userId;

    // An ANSWERED call gets a grace window instead of ending: a Wi-Fi ↔ 4G
    // switch drops the socket while the audio still flows, and the client
    // reconnects and resumes. A ringing call ends at once (the caller vanished).
    this.sessions.startGrace(uid, state.connId, now + RESUME_GRACE_MS);

    for (const ended of this.sessions.endSessionsOfSocket(uid, state.connId)) {
      this.sendUser(ended.notifyUserId, { type: "hangup", from: "system", reason: "peer-offline" });
      // The dropped user's other devices mirror the call UI too.
      this.sendUser(uid, { type: "hangup", from: "system", reason: "peer-offline" }, state.connId);
      this.ctx.waitUntil(notifyCallEnded(this.env, ended.agentId, ended.customerId));
    }

    // Last socket of this user → everything they were in goes with them
    // (calls in grace are left to the alarm).
    const stillHere = this.live().some(
      (s) => s.state.registered && s.state.userId === uid && s.connId !== state.connId,
    );
    if (!stillHere) {
      if (state.role === "agent") {
        this.drainAgent(uid, "agent-offline", now, "system");
      } else {
        const s = this.sessions.get(uid);
        if (s && s.graceUntil === null) {
          const out = this.sessions.onCustomerHangup(uid);
          if (out.kind === "notify-agent") {
            this.sendUser(out.agentId, { type: "hangup", from: "system", reason: "peer-offline" });
            this.ctx.waitUntil(notifyCallEnded(this.env, out.agentId, uid));
          }
        }
      }
    }
    await this.persist();
    // Presence only changes when an AGENT's state did.
    if (state.role === "agent") this.broadcastPresence();
  }

  // ── Timers ────────────────────────────────────────────────────────

  async alarm() {
    const now = Date.now();

    // Calls whose socket dropped and never came back.
    for (const ended of this.sessions.endExpiredGrace(now)) {
      this.sendUser(ended.notifyUserId, { type: "hangup", from: "system", reason: "peer-offline" });
      this.ctx.waitUntil(notifyCallEnded(this.env, ended.agentId, ended.customerId));
    }

    // Rings nobody picked up: the customer-initiated ones move to the next
    // agent; an agent's unanswered outbound call just ends.
    for (const s of this.sessions.ringExpired(now, this.ringMs)) {
      const timedOutAgent = s.agentId;
      if (s.initiator === "customer") {
        // Stop the timed-out agent's phone ringing, then escalate.
        this.sendUser(timedOutAgent, { type: "hangup", from: "system", reason: "timeout" });
        this.ctx.waitUntil(notifyCallEnded(this.env, timedOutAgent, s.customerId));
        const out = this.sessions.onAgentHangup(timedOutAgent, "timeout", this.pick, now);
        if (out.kind === "rerouted") {
          const next = this.sessions.get(out.customerId);
          if (next) this.relayOffer(next);
        } else if (out.kind === "notify") {
          this.sendUser(out.customerId, { type: "hangup", from: "system", reason: "timeout" });
        }
      } else {
        this.sessions.remove(s.customerId);
        this.sendUser(s.customerId, { type: "hangup", from: "system", reason: "timeout" });
        this.sendUser(s.agentId, { type: "hangup", from: "system", reason: "timeout" });
      }
    }

    // Calls past the maximum length (a forgotten open line).
    for (const s of this.sessions.overlong(now, this.maxCallMs)) {
      this.sessions.remove(s.customerId);
      for (const id of [s.customerId, s.agentId]) {
        this.sendUser(id, { type: "hangup", from: "system", reason: "max-duration" });
      }
      this.ctx.waitUntil(notifyCallEnded(this.env, s.agentId, s.customerId));
    }

    await this.persist();
    this.broadcastPresence();
  }

  // ── ICE / TURN ────────────────────────────────────────────────────

  /**
   * Current TURN credentials (cached until half the TTL). At most every 30
   * minutes the refreshed list is also pushed to every registered socket as an
   * `ice-servers` frame, so a shift-long session rotates credentials without
   * reconnecting. Falls back to public STUN when TURN is not configured.
   */
  private async currentIceServers(): Promise<IceServerConfig[]> {
    const servers = await iceServersFor(this.env);
    if (servers === PUBLIC_ICE_SERVERS && !this.warnedNoTurn) {
      // Without a TURN relay, users behind corporate firewalls / symmetric NAT
      // cannot connect audio at all. Say so loudly, once.
      this.warnedNoTurn = true;
      console.warn("[calls] TURN_KEY_ID / TURN_KEY_API_TOKEN not set — public STUN only");
    }
    const now = Date.now();
    if (servers !== PUBLIC_ICE_SERVERS && now - this.lastIcePushAt > ICE_ROTATION_PUSH_MS) {
      this.lastIcePushAt = now;
      for (const s of this.live()) {
        if (s.state.registered) this.send(s.ws, { type: "ice-servers", iceServers: servers });
      }
    }
    return servers;
  }
}
