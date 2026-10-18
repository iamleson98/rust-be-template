import { DurableObject } from "cloudflare:workers";

/**
 * CallHub — the WebRTC signalling relay behind `/ws-call` (port of the
 * Rust `audio_call` hub). Two browsers exchange SDP offers / answers /
 * ICE candidates through this DO; the audio itself flows peer-to-peer.
 *
 * Frame protocol (see the SPA's `features/call/audio-call-client.ts`):
 *   client → server : register {role, userId, channelId, resume?} ·
 *                     call {to, from, kind: offer|answer|ice|renegotiate,
 *                     sdp?, candidate?} · hangup {to, from, reason} ·
 *                     heartbeat
 *   server → client : registered {onlineAgents, activeCall, iceServers} ·
 *                     ice-servers · presence {onlineAgents} · incoming ·
 *                     answer · ice · renegotiate · hangup · error
 *
 * `to: "agent"` means "any agent registered on this channel".
 */

const PUBLIC_ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

interface CallSession {
  id: string;
  ws: WebSocket;
  userId: string;
  name: string;
  role: "customer" | "agent";
  channelId: string | null;
  registered: boolean;
  connectedAt: number;
}

export class CallHub extends DurableObject {
  private sessions = new Map<string, CallSession>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws-call" && request.headers.get("Upgrade") === "websocket") {
      const ok = await this.authenticate(request, url);
      if (!ok) return new Response("unauthorized", { status: 401 });
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
      const row = (await (this.env as CloudflareEnv).DB
        .prepare(`SELECT id, full_name, role, status FROM "user" WHERE id = ? LIMIT 1`)
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
    const id = crypto.randomUUID();
    this.sessions.set(id, {
      id,
      ws: server,
      userId,
      name,
      role: "customer",
      channelId: null,
      registered: false,
      connectedAt: Date.now(),
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const session = this.findBySocket(ws);
    if (!session) return;

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
        // keepalive — nothing to answer
        return;

      case "register": {
        session.role = frame.role === "agent" ? "agent" : "customer";
        session.userId = String(frame.userId ?? session.userId);
        session.channelId = frame.channelId ? String(frame.channelId) : session.channelId;
        session.registered = true;
        this.sendFrame(ws, {
          type: "registered",
          onlineAgents: this.countAgents(session.channelId),
          activeCall: false,
          iceServers: PUBLIC_ICE_SERVERS,
        });
        this.broadcastPresence(session.channelId);
        return;
      }

      case "call": {
        const kind = String(frame.kind ?? "");
        const to = String(frame.to ?? "");
        const targets = this.resolveTargets(session, to);
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
              from: session.userId,
              channelId: session.channelId,
              callerName: session.name,
              sdp: frame.sdp,
            });
          } else if (kind === "answer") {
            this.sendFrame(t.ws, {
              type: "answer",
              from: session.userId,
              sdp: frame.sdp,
              ...(frame.iceRestart ? { iceRestart: true } : {}),
            });
          } else if (kind === "ice") {
            this.sendFrame(t.ws, {
              type: "ice",
              from: session.userId,
              candidate: frame.candidate,
            });
          } else if (kind === "renegotiate") {
            this.sendFrame(t.ws, {
              type: "renegotiate",
              from: session.userId,
              sdp: frame.sdp,
            });
          }
        }
        return;
      }

      case "hangup": {
        const to = String(frame.to ?? "");
        const targets = this.resolveTargets(session, to);
        for (const t of targets) {
          this.sendFrame(t.ws, {
            type: "hangup",
            reason: String(frame.reason ?? "remote"),
            from: session.userId,
          });
        }
        return;
      }

      default:
        return;
    }
  }

  /** `to: "agent"` → every agent on the caller's channel; otherwise the user id. */
  private resolveTargets(sender: CallSession, to: string): CallSession[] {
    if (to === "agent") {
      return [...this.sessions.values()].filter(
        (s) => s.registered && s.role === "agent" && s.channelId === sender.channelId && s.id !== sender.id,
      );
    }
    if (!to) return [];
    return [...this.sessions.values()].filter((s) => s.userId === to && s.id !== sender.id);
  }

  private countAgents(channelId: string | null): number {
    return [...this.sessions.values()].filter(
      (s) => s.registered && s.role === "agent" && (!channelId || s.channelId === channelId),
    ).length;
  }

  private broadcastPresence(channelId: string | null) {
    const n = this.countAgents(channelId);
    for (const s of this.sessions.values()) {
      if (!s.registered) continue;
      if (channelId && s.channelId !== channelId && s.role === "agent") continue;
      this.sendFrame(s.ws, { type: "presence", onlineAgents: n });
    }
  }

  async webSocketClose(ws: WebSocket) {
    const session = this.findBySocket(ws);
    if (!session) return;
    this.sessions.delete(session.id);
    this.broadcastPresence(session.channelId);
  }

  async webSocketError(ws: WebSocket) {
    const session = this.findBySocket(ws);
    if (!session) return;
    this.sessions.delete(session.id);
    this.broadcastPresence(session.channelId);
  }

  private findBySocket(ws: WebSocket): CallSession | undefined {
    for (const s of this.sessions.values()) if (s.ws === ws) return s;
    return undefined;
  }

  private sendFrame(ws: WebSocket, frame: Record<string, unknown>) {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // closed mid-send
    }
  }
}
