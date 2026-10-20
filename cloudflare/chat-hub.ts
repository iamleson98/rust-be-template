import { DurableObject } from "cloudflare:workers";
import { authenticateWs, type WsUser } from "./src/lib/realtime/ws-auth";

/**
 * ChatHub — the WebSocket hub behind `/ws` (port of the Rust `ws::hub`).
 *
 * One Durable Object instance ("global") holds every live chat socket:
 * customer widget tabs, staff workspace tabs. It answers the SPA's JSON
 * envelope protocol (`{"type":"<event>", ...}`):
 *
 *   client → server : join {channelId} · leave · message {channelId, text,
 *                     clientMsgId} · typing {channelId, isTyping} · ping
 *   server → client : hello · joined {channelId, botActive} · message ·
 *                     typing · channel_message · channel_assigned ·
 *                     channel_released · channel_closed · customer_presence ·
 *                     staff_presence · error · pong
 *
 * Messages are persisted straight to D1 (idempotent on clientMsgId — same
 * semantics as POST /api/chat/channels/{id}/messages) and fanned out to
 * the channel room; staff tabs not viewing the channel get
 * `channel_message` for the unread badge.
 *
 * REST endpoints (claim / release / close) push lifecycle events here via
 * `POST /emit` so both sides stay in sync with the REST state.
 *
 * Hibernation-safe: session state rides on each WebSocket's attachment
 * (survives DO eviction), and the live set always comes from
 * `ctx.getWebSockets()` — a hibernated-and-woken DO rehydrates instead of
 * dropping every live socket on the floor.
 */

interface Session {
  connId: string;
  userId: string;
  name: string;
  role: string;
  isStaff: boolean;
  channelId: string | null;
  connectedAt: number;
}

export class ChatHub extends DurableObject<CloudflareEnv> {
  private presenceSeq = 0;
  /** Staff on an answered call, pushed by the CallHub (persisted: survives hibernation). */
  private inCall = new Set<string>();

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    // Liveness pings (the exact `{"type":"ping"}` frame) are answered by the
    // platform without waking this DO; richer frames reach webSocketMessage.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'),
    );
    ctx.blockConcurrencyWhile(async () => {
      this.inCall = new Set((await ctx.storage.get<string[]>("inCall")) ?? []);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── WebSocket upgrade ────────────────────────────────────────
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const auth = await authenticateWs(request, this.env);
      if (!auth.ok) return new Response(auth.reason, { status: auth.status });
      return this.acceptSocket(auth.user);
    }

    // ── REST-side lifecycle events (claim/release/close/read) ────
    if (url.pathname === "/emit" && request.method === "POST") {
      const event = (await request.json()) as Record<string, unknown>;
      this.broadcastFrame(event);
      // channel lifecycle changes refresh the staff queue snapshot too
      if (typeof event.type === "string" && event.type.startsWith("channel_")) {
        this.broadcastFrame({ type: "channels_changed" }, (s) => s.isStaff);
      }
      return new Response("ok");
    }

    // ── Staff-on-a-call set, pushed by the CallHub ───────────────
    if (url.pathname === "/call-state" && request.method === "POST") {
      const body = (await request.json()) as { inCall?: string[] };
      this.inCall = new Set(body.inCall ?? []);
      await this.ctx.storage.put("inCall", [...this.inCall]);
      this.broadcastStaffPresence();
      return new Response("ok");
    }

    // ── Presence heartbeat from the REST layer ───────────────────
    if (url.pathname === "/seen" && request.method === "POST") {
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  private acceptSocket(user: WsUser): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);

    // Session state rides on the socket — it survives DO eviction.
    const isStaff = user.isStaff;
    server.serializeAttachment({
      connId: crypto.randomUUID(),
      userId: user.id,
      name: user.fullName,
      role: user.role,
      isStaff,
      channelId: null,
      connectedAt: Date.now(),
    } satisfies Session);

    this.sendFrame(server, {
      type: "hello",
      userId: user.id,
      name: user.fullName,
      role: user.role,
    });

    // Presence fan-out.
    if (isStaff) {
      void this.markPresence(user.id, user.fullName, user.role, true);
      this.broadcastStaffPresence();
    } else {
      this.presenceSeq += 1;
      this.broadcastFrame(
        {
          type: "customer_presence",
          userId: user.id,
          online: true,
          seq: this.presenceSeq,
        },
        (s) => s.isStaff,
      );
      this.broadcastStaffPresence();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Every live socket + its persisted session state. */
  private liveSessions(): Array<{ connId: string; ws: WebSocket; state: Session }> {
    const out: Array<{ connId: string; ws: WebSocket; state: Session }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as Session | null;
      if (state?.connId) out.push({ connId: state.connId, ws, state });
    }
    return out;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const state = ws.deserializeAttachment() as Session | null;
    if (!state) return;

    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as Record<
        string,
        unknown
      >;
    } catch {
      this.sendFrame(ws, { type: "error", message: "invalid json" });
      return;
    }

    const type = String(frame.type ?? "");
    switch (type) {
      case "ping":
        // Fallback for non-exact pings (old clients, test scripts with
        // timestamps): fixed `{"type":"ping"}` frames are answered by the
        // platform auto-response above without waking this DO.
        this.sendFrame(ws, { type: "pong", __server_ts: Date.now() });
        break;

      case "join": {
        const channelId = String(frame.channelId ?? "");
        if (!channelId) break;
        // A customer may only listen to their OWN conversation: everything said
        // in a joined channel is broadcast to every socket in it.
        if (!state.isStaff && !(await this.ownsChannel(state.userId, channelId))) {
          this.sendFrame(ws, { type: "error", message: "channel not found" });
          break;
        }
        state.channelId = channelId;
        ws.serializeAttachment(state);
        this.sendFrame(ws, { type: "joined", channelId, botActive: false });
        // A staff opening a channel takes the assignment (Rust behaviour).
        if (state.isStaff) {
          void this.assignChannel(channelId, state);
        }
        break;
      }

      case "leave":
        state.channelId = null;
        ws.serializeAttachment(state);
        break;

      case "typing": {
        const channelId = String(frame.channelId ?? state.channelId ?? "");
        const isTyping = !!frame.isTyping;
        this.broadcastFrame(
          {
            type: "typing",
            channelId,
            userId: state.userId,
            name: state.name,
            isTyping,
          },
          (s) => s.userId !== state.userId && s.channelId === channelId,
        );
        break;
      }

      case "message": {
        const channelId = String(frame.channelId ?? state.channelId ?? "");
        const text = String(frame.text ?? frame.content ?? "").trim();
        const clientMsgId = frame.clientMsgId ? String(frame.clientMsgId) : null;
        if (!channelId || !text) break;
        if (text.length > 4000) {
          this.sendFrame(ws, { type: "error", message: "content too long" });
          break;
        }
        try {
          const saved = await this.persistMessage(state, channelId, text, clientMsgId);
          this.broadcastFrame(
            {
              type: "message",
              channelId,
              id: saved.id,
              senderType: saved.senderType,
              senderId: state.userId,
              senderName: state.name,
              text,
              clientMsgId,
              createdAt: saved.createdAt,
            },
            (s) => s.channelId === channelId,
          );
          // Staff not viewing the channel get the unread ping.
          this.broadcastFrame(
            { type: "channel_message", channelId },
            (s) => s.isStaff && s.channelId !== channelId,
          );
        } catch (e) {
          this.sendFrame(ws, {
            type: "error",
            message: e instanceof Error ? e.message : "send failed",
          });
        }
        break;
      }

      default:
        this.sendFrame(ws, { type: "error", message: `unknown message type: ${type}` });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, wasClean: boolean) {
    void code;
    void wasClean;
    this.dropSession(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.dropSession(ws);
  }

  private dropSession(ws: WebSocket) {
    const state = ws.deserializeAttachment() as Session | null;
    if (!state) return;
    try {
      ws.close();
    } catch {
      // already closed
    }
    const stillOnline = this.liveSessions().some((s) => s.state.userId === state.userId);
    if (!stillOnline) {
      if (state.isStaff) {
        void this.markPresence(state.userId, state.name, state.role, false);
      } else {
        this.presenceSeq += 1;
        this.broadcastFrame(
          { type: "customer_presence", userId: state.userId, online: false, seq: this.presenceSeq },
          (s) => s.isStaff,
        );
      }
      this.broadcastStaffPresence();
    }
  }

  private async ownsChannel(userId: string, channelId: string): Promise<boolean> {
    const row = await this.env.DB.prepare(`SELECT user_id FROM chat_channel WHERE id = ? LIMIT 1`)
      .bind(channelId)
      .first<{ user_id: string }>();
    return row?.user_id === userId;
  }

  /** Staff joining a room auto-claims the open channel (Rust semantics). */
  private async assignChannel(channelId: string, staff: Session) {
    try {
      const d1 = (this.env as CloudflareEnv).DB;
      const now = new Date().toISOString();
      const ch = await d1
        .prepare(`SELECT status FROM chat_channel WHERE id = ? LIMIT 1`)
        .bind(channelId)
        .first<{ status: string }>();
      if (ch && ch.status === "open") {
        await d1
          .prepare(
            `INSERT INTO chat_assignment (id, channel_id, employee_id, assigned_at) VALUES (?, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), channelId, staff.userId, now)
          .run();
        await d1
          .prepare(`UPDATE chat_channel SET status = 'assigned' WHERE id = ?`)
          .bind(channelId)
          .run();
        this.broadcastFrame({
          type: "channel_assigned",
          channelId,
          employeeId: staff.userId,
          employeeName: staff.name,
        });
      }
    } catch {
      // assignment is best-effort — the REST claim endpoint is authoritative
    }
  }

  /** Insert a chat message (idempotent on clientMsgId) + bump previews. */
  private async persistMessage(
    session: Session,
    channelId: string,
    text: string,
    clientMsgId: string | null,
  ) {
    const d1 = (this.env as CloudflareEnv).DB;

    // Access check: staff may write anywhere; customers only to their channel.
    if (!session.isStaff) {
      const ch = await d1
        .prepare(`SELECT user_id FROM chat_channel WHERE id = ? LIMIT 1`)
        .bind(channelId)
        .first<{ user_id: string }>();
      if (!ch || ch.user_id !== session.userId) throw new Error("channel not found");
    }

    if (clientMsgId) {
      const existing = await d1
        .prepare(
          `SELECT id, sender_type, created_at FROM chat_message WHERE channel_id = ? AND client_msg_id = ? LIMIT 1`,
        )
        .bind(channelId, clientMsgId)
        .first<{ id: string; sender_type: string; created_at: string }>();
      if (existing) {
        return {
          id: existing.id,
          senderType: existing.sender_type,
          createdAt: existing.created_at,
        };
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const senderType = session.isStaff ? "employee" : "user";
    await d1
      .prepare(
        `INSERT INTO chat_message (id, channel_id, sender_type, sender_id, content, kind, status, client_msg_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'text', 'sent', ?, ?)`,
      )
      .bind(id, channelId, senderType, session.userId, text, clientMsgId, now)
      .run();
    const unreadCol = session.isStaff ? "unread_user" : "unread_employee";
    await d1
      .prepare(
        `UPDATE chat_channel SET last_message_at = ?, last_message_preview = ?, ${unreadCol} = ${unreadCol} + 1 WHERE id = ?`,
      )
      .bind(now, text.slice(0, 80), channelId)
      .run();
    return { id, senderType, createdAt: now };
  }

  /** Track staff presence in D1 so the REST snapshot agrees with the hub. */
  private async markPresence(userId: string, name: string, role: string, online: boolean) {
    try {
      const d1 = (this.env as CloudflareEnv).DB;
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      await d1
        .prepare(
          `INSERT INTO staff_presence_state (user_id, name, role, online, last_seen_at, last_online_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET
             online = excluded.online,
             last_seen_at = excluded.last_seen_at,
             last_online_at = CASE WHEN excluded.online = 1 THEN excluded.last_online_at ELSE last_online_at END`,
        )
        .bind(userId, name, role, online ? 1 : 0, now, online ? now : null)
        .run();
    } catch {
      // presence is best-effort
    }
  }

  private broadcastStaffPresence() {
    const staff = this.liveSessions().filter((s) => s.state.isStaff);
    const snapshot = {
      type: "staff_presence",
      staff: staff.map((s) => ({
        userId: s.state.userId,
        name: s.state.name,
        role: s.state.role,
        online: true,
        // "busy" = on an answered call (the web strip labels it "on call");
        // the phone's team board reads `inCall`.
        busy: this.inCall.has(s.state.userId),
        inCall: this.inCall.has(s.state.userId),
        activeChats: s.state.channelId ? 1 : 0,
      })),
      offline: [] as Array<{ userId: string; name: string; role: string; lastSeenAt: string }>,
      botActive: staff.length === 0,
    };
    this.broadcastFrame(snapshot);
  }

  private broadcastFrame(frame: Record<string, unknown>, filter?: (s: Session) => boolean) {
    for (const s of this.liveSessions()) {
      if (filter && !filter(s.state)) continue;
      this.sendFrame(s.ws, frame);
    }
  }

  private sendFrame(ws: WebSocket, frame: Record<string, unknown>) {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // socket closed mid-send; the close handler cleans up
    }
  }
}
