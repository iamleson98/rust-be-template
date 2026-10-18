import { DurableObject } from "cloudflare:workers";
import {
  iceServersFor,
  PUBLIC_ICE_SERVERS,
  type IceServerConfig,
} from "./src/lib/services/turn-credentials";

/**
 * CallHub — the WebRTC signalling relay behind `/ws-call` (port of the
 * Rust `audio_call` hub). Two browsers exchange SDP offers / answers /
 * ICE candidates through this DO; the audio itself flows peer to peer,
 * relayed by Cloudflare TURN when a direct path is blocked (corporate
 * firewalls, symmetric NAT — `turns:` over TCP 443 even passes
 * HTTPS-only proxies).
 *
 * Frame protocol (see the SPA's `features/call/audio-call-client.ts`):
 *   client → server : register {role, userId, channelId, resume?} ·
 *                     call {to, from, kind: offer|answer|ice|renegotiate,
 *                     sdp?, candidate?} · hangup {to, from, reason} ·
 *                     heartbeat
 *   server → client : registered {onlineAgents, activeCall, iceServers} ·
 *                     ice-servers (credential rotation) · presence
 *                     {onlineAgents} · incoming · answer · ice ·
 *                     renegotiate · hangup · error
 *
 * `to: "agent"` means "any agent registered on this channel".
 *
 * Hibernation-safe: every socket's session state lives in the WebSocket
 * attachment (survives DO eviction), the live set comes from
 * `ctx.getWebSockets()`, and heartbeats are answered by the platform
 * (`setWebSocketAutoResponse`) without waking the DO — so thousands of
 * idle sockets cost nothing. `registered.activeCall` tells a
 * reconnecting client whether its call survived the blip (audio is
 * peer to peer; only signalling goes through here).
 */

interface CallSession {
  /** Unique per socket (one user may hold several). */
  connId: string;
  userId: string;
  name: string;
  role: "customer" | "agent";
  channelId: string | null;
  registered: boolean;
  connectedAt: number;
}

/** An in-progress call: offerer → answerer ("" while still ringing). */
interface ActiveCall {
  caller: string;
  callee: string;
}

const ICE_ROTATION_PUSH_MS = 3600_000;

export class CallHub extends DurableObject {
  /** In-call bookkeeping (in-memory; a DO restart cleanly ends all calls —
   * clients treat registered.activeCall=false as call-gone). */
  private activeCalls = new Map<string, ActiveCall>(); // callKey → pair
  private callsBySide = new Map<string, Set<string>>(); // connId → callKeys
  private lastIcePushAt = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws-call" && request.headers.get("Upgrade") === "websocket") {
      const ok = await this.authenticate(request, url);
      if (!ok) return new Response("unauthorized", { status: 401 });
      // Heartbeats (`{"type":"heartbeat"}` every 25s) are answered by the
      // platform without waking this DO.
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair('{"type":"heartbeat"}', '{"type":"heartbeat-ack"}'),
      );
      return this.acceptSocket(ok.userId, ok.name);
    }
    return new Response("not found", { status: 404 });
  }

  /** JWT (Bearer / ?token= / access_token cookie) → {userId, name}. */
  private async authenticate(request: Request, url: URL) {
    let token: string | null = url.searchParams.get("token");
    if (!token) {
      const authz = request.headers.get("authorization");
      if (authz?.toLowerCase().startsWith("bearer ")) token = authz.slice(7).trim();
    }
    if (!token) {
      const cookie = request.headers.get("cookie") ?? "";
      const m = /(?:^|;\s*)access_token=([^;]+)/.exec(cookie);
      if (m) token = decodeURIComponent(m[1]!);
    }
    if (!token) return null;
    try {
      const { jwtVerify } = await import("jose");
      const secret = new TextEncoder().encode((this.env as CloudflareEnv).JWT_SECRET ?? "");
      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      const userId = String(payload.sub ?? "");
      if (!userId) return null;
      const row = (await (this.env as CloudflareEnv).DB.prepare(
        `SELECT id, full_name, role, status FROM "user" WHERE id = ? LIMIT 1`,
      )
        .bind(userId)
        .first<{ id: string; full_name: string; role: string; status: string }>()) as {
        id: string;
        full_name: string;
        role: string;
        status: string;
      } | null;
      if (!row || row.status !== "active") return null;
      return { userId: row.id, name: row.full_name };
    } catch {
      return null;
    }
  }

  private acceptSocket(userId: string, name: string): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    // Session state rides on the socket itself — it survives eviction.
    server.serializeAttachment({
      connId: crypto.randomUUID(),
      userId,
      name,
      role: "customer",
      channelId: null,
      registered: false,
      connectedAt: Date.now(),
    } satisfies CallSession);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Every live socket + its persisted session state. */
  private liveSessions(): Array<{ connId: string; ws: WebSocket; state: CallSession }> {
    const out: Array<{ connId: string; ws: WebSocket; state: CallSession }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as CallSession | null;
      if (state?.connId) out.push({ connId: state.connId, ws, state });
    }
    return out;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const state = ws.deserializeAttachment() as CallSession | null;
    if (!state) return;

    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as Record<
        string,
        unknown
      >;
    } catch {
      return;
    }

    switch (String(frame.type ?? "")) {
      case "heartbeat":
        // Normally answered by the platform auto-response; kept for
        // non-matching heartbeat formats.
        return;

      case "register": {
        state.role = frame.role === "agent" ? "agent" : "customer";
        state.userId = String(frame.userId ?? state.userId);
        state.channelId = frame.channelId ? String(frame.channelId) : state.channelId;
        state.registered = true;
        ws.serializeAttachment(state);
        const iceServers = await this.currentIceServers();
        this.sendFrame(ws, {
          type: "registered",
          onlineAgents: this.countAgents(state.channelId),
          activeCall: this.callsOf(state.connId).length > 0,
          iceServers,
        });
        this.broadcastPresence(state.channelId);
        return;
      }

      case "call": {
        const kind = String(frame.kind ?? "");
        const to = String(frame.to ?? "");
        const targets = this.resolveTargets(state, to, state.connId);
        if (targets.length === 0) {
          this.sendFrame(ws, {
            type: "error",
            code: "peer-unavailable",
            message: "The other side is not connected.",
          });
          return;
        }
        for (const t of targets) {
          if (kind === "offer") {
            this.sendFrame(t.ws, {
              type: "incoming",
              from: state.userId,
              channelId: state.channelId,
              callerName: state.name,
              sdp: frame.sdp,
            });
            this.beginCall(state.connId, t.connId);
          } else if (kind === "answer") {
            this.completeCall(t.connId, state.connId);
            this.sendFrame(t.ws, {
              type: "answer",
              from: state.userId,
              sdp: frame.sdp,
              ...(frame.iceRestart ? { iceRestart: true } : {}),
            });
          } else if (kind === "ice") {
            this.sendFrame(t.ws, {
              type: "ice",
              from: state.userId,
              candidate: frame.candidate,
            });
          } else if (kind === "renegotiate") {
            this.sendFrame(t.ws, {
              type: "renegotiate",
              from: state.userId,
              sdp: frame.sdp,
            });
          }
        }
        return;
      }

      case "hangup": {
        const to = String(frame.to ?? "");
        const targets = this.resolveTargets(state, to, state.connId);
        for (const t of targets) {
          this.endCallBetween(state.connId, t.connId);
          this.sendFrame(t.ws, {
            type: "hangup",
            reason: String(frame.reason ?? "remote"),
            from: state.userId,
          });
        }
        this.endCall(state.connId);
        return;
      }

      default:
        return;
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.dropSocket(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.dropSocket(ws);
  }

  private dropSocket(ws: WebSocket) {
    const state = ws.deserializeAttachment() as CallSession | null;
    if (!state) return;
    // Any call this side was in ends for bookkeeping (the peer gets a
    // hangup so its UI does not ring into a void).
    for (const other of this.peersOf(state.connId)) {
      this.endCallBetween(state.connId, other);
      this.sendToConn(other, { type: "hangup", reason: "remote", from: state.userId });
    }
    this.endCall(state.connId);
    this.broadcastPresence(state.channelId);
  }

  // ── In-call bookkeeping ──────────────────────────────────────

  private beginCall(callerConn: string, calleeConn: string) {
    const callKey = `${callerConn}>${calleeConn}`;
    this.activeCalls.set(callKey, { caller: callerConn, callee: "" });
    this.addSide(callerConn, callKey);
    this.addSide(calleeConn, callKey);
  }

  /** The answerer filled the ringing pair in. */
  private completeCall(callerConn: string, calleeConn: string) {
    const callKey = `${callerConn}>${calleeConn}`;
    const call = this.activeCalls.get(callKey);
    if (call) call.callee = calleeConn;
  }

  private endCallBetween(aConn: string, bConn: string) {
    this.activeCalls.delete(`${aConn}>${bConn}`);
    this.activeCalls.delete(`${bConn}>${aConn}`);
    this.dropSide(aConn, `${aConn}>${bConn}`);
    this.dropSide(aConn, `${bConn}>${aConn}`);
    this.dropSide(bConn, `${aConn}>${bConn}`);
    this.dropSide(bConn, `${bConn}>${aConn}`);
  }

  private endCall(conn: string) {
    for (const callKey of this.callsBySide.get(conn) ?? []) {
      this.activeCalls.delete(callKey);
    }
    this.callsBySide.delete(conn);
  }

  /** Other sides this conn shares an active call with. */
  private peersOf(conn: string): string[] {
    const peers = new Set<string>();
    for (const callKey of this.callsBySide.get(conn) ?? []) {
      const call = this.activeCalls.get(callKey);
      if (!call) continue;
      if (call.caller === conn && call.callee) peers.add(call.callee);
      else if (call.callee === conn) peers.add(call.caller);
      else if (call.caller === conn) {
        // ringing: the callee is the other side of the key
        const other = callKey.split(">")[1] ?? "";
        if (other && other !== conn) peers.add(other);
      }
    }
    return [...peers];
  }

  private callsOf(conn: string): string[] {
    return [...(this.callsBySide.get(conn) ?? [])].filter(
      (callKey) => this.activeCalls.get(callKey) != null,
    );
  }

  private addSide(conn: string, callKey: string) {
    const set = this.callsBySide.get(conn) ?? new Set<string>();
    set.add(callKey);
    this.callsBySide.set(conn, set);
  }

  private dropSide(conn: string, callKey: string) {
    const set = this.callsBySide.get(conn);
    if (!set) return;
    set.delete(callKey);
    if (set.size === 0) this.callsBySide.delete(conn);
  }

  private sendToConn(conn: string, frame: Record<string, unknown>) {
    for (const s of this.liveSessions()) {
      if (s.connId === conn) this.sendFrame(s.ws, frame);
    }
  }

  // ── ICE / TURN ────────────────────────────────────────────────

  /**
   * Current TURN credentials (cached in-module until half the TTL); at
   * most once per hour the refreshed list is also pushed to every
   * registered socket as an `ice-servers` frame so long-lived sessions
   * rotate credentials without reconnecting. Falls back to public STUN
   * when TURN is not configured.
   */
  private async currentIceServers(): Promise<IceServerConfig[]> {
    const env = this.env as unknown as {
      TURN_KEY_ID?: string;
      TURN_KEY_API_TOKEN?: string;
      TURN_TTL_SECONDS?: string;
    };
    const servers = await iceServersFor(env);
    const now = Date.now();
    if (servers !== PUBLIC_ICE_SERVERS && now - this.lastIcePushAt > ICE_ROTATION_PUSH_MS) {
      this.lastIcePushAt = now;
      for (const s of this.liveSessions()) {
        if (s.state.registered) {
          this.sendFrame(s.ws, { type: "ice-servers", iceServers: servers });
        }
      }
    }
    return servers;
  }

  // ── Presence ──────────────────────────────────────────────────

  /** `to: "agent"` → every agent on the caller's channel; otherwise the user id. */
  private resolveTargets(
    sender: CallSession,
    to: string,
    senderConn: string,
  ): Array<{ connId: string; ws: WebSocket; state: CallSession }> {
    if (to === "agent") {
      return this.liveSessions().filter(
        (s) =>
          s.state.registered &&
          s.state.role === "agent" &&
          s.state.channelId === sender.channelId &&
          s.connId !== senderConn,
      );
    }
    if (!to) return [];
    return this.liveSessions().filter((s) => s.state.userId === to && s.connId !== senderConn);
  }

  private countAgents(channelId: string | null): number {
    return this.liveSessions().filter(
      (s) =>
        s.state.registered &&
        s.state.role === "agent" &&
        (!channelId || s.state.channelId === channelId),
    ).length;
  }

  private broadcastPresence(channelId: string | null) {
    const n = this.countAgents(channelId);
    for (const s of this.liveSessions()) {
      if (!s.state.registered) continue;
      if (channelId && s.state.channelId !== channelId && s.state.role === "agent") continue;
      this.sendFrame(s.ws, { type: "presence", onlineAgents: n });
    }
  }

  private sendFrame(ws: WebSocket, frame: Record<string, unknown>) {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // closed mid-send
    }
  }
}
