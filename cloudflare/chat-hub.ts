import { DurableObject } from "cloudflare:workers";
import { authenticateWs, type WsUser } from "./src/lib/realtime/ws-auth";
import {
  botActive,
  onlineCount,
  availableCount,
  staffPresenceFrame,
  type RoutingOutcome,
  type StaffEntry,
} from "./src/lib/chat/presence";
import {
  MAX_CONTENT_CHARS,
  activeLoads,
  clearUnread,
  findMessageByClientId,
  getChannel,
  insertMessage,
  routeUserMessage,
  type MessageRow,
} from "./src/lib/chat/ops";

/**
 * ChatHub — the WebSocket hub behind `/ws` (port of the Rust `ws::hub`,
 * `ws::handler` and `presence`).
 *
 * One Durable Object instance ("global") holds every live chat socket:
 * customer widget tabs, staff workspace tabs. It answers the SPA's JSON
 * envelope protocol (`{"type":"<event>", ...}`):
 *
 *   client → server : join {channelId} · leave · message {channelId, text,
 *                     clientMsgId} · read {channelId} · typing {channelId,
 *                     isTyping} · ping
 *   server → client : hello · joined {channelId, userId, onlineEmployees,
 *                     availableEmployees, botActive} · presence · message ·
 *                     ack {clientMsgId, id} · read · typing · channel_message
 *                     · channel_created · channel_assigned · channel_released
 *                     · channel_closed · channels_changed · customer_presence
 *                     · staff_presence · error · pong
 *
 * Messages are stored through `lib/chat/ops.ts` (the same code the REST
 * routes run), idempotent on clientMsgId, then fanned out to the channel
 * room. A customer's message is also routed: the assignee (or the most
 * available staff member, who becomes the assignee) is notified, admins
 * always are, and the room hears who took the chat.
 *
 * The REST layer reaches the hub over `fetch` (`chat-hub-bridge.ts`):
 * `/emit` (lifecycle frames), `/deliver` (a REST-stored message),
 * `/route` (creation-time assignment), `/online-customers`, `/staff`.
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
  brandId: string | null;
  isStaff: boolean;
  channelId: string | null;
  connectedAt: number;
}

/** What a stored message looks like on the wire. */
interface Delivered {
  id: string;
  channelId: string;
  senderType: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
  clientMsgId?: string | null;
}

const OFFLINE_LOOKBACK_MS = 7 * 24 * 3600_000;
const OFFLINE_LIMIT = 50;
const NOTIFY_PREVIEW_CHARS = 80;

export class ChatHub extends DurableObject<CloudflareEnv> {
  /** Orders customer online/offline events against the `/online-customers` snapshot. */
  private presenceSeq = 0;
  /** Staff on an answered call, pushed by the CallHub (persisted: survives hibernation). */
  private inCall = new Set<string>();
  /**
   * Admins own the queue without assignment rows, so their chat load lives
   * here (Rust keeps it in process memory too, and starts from zero on a
   * restart); so does the last-picked time that makes equals take turns.
   */
  private adminLoad = new Map<string, number>();
  private lastAssigned = new Map<string, number>();

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
    const post = request.method === "POST";

    // ── WebSocket upgrade ────────────────────────────────────────
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const auth = await authenticateWs(request, this.env);
      if (!auth.ok) return new Response(auth.reason, { status: auth.status });
      return this.acceptSocket(auth.user);
    }

    // ── REST-side lifecycle events (created/claim/release/close) ─
    if (url.pathname === "/emit" && post) {
      const { frame, scope } = (await request.json()) as {
        frame: Record<string, unknown>;
        scope: "all" | "staff" | "room";
      };
      this.broadcastFrame(frame, (s) =>
        scope === "all" ? true : scope === "staff" ? s.isStaff : s.channelId === frame.channelId,
      );
      // An assignment change moves someone's load: refresh the staff panels.
      if (["channel_assigned", "channel_released", "channel_closed"].includes(String(frame.type)))
        await this.broadcastStaffPresence();
      return new Response("ok");
    }

    // ── A message the REST layer stored: room fan-out + routing ──
    if (url.pathname === "/deliver" && post) {
      await this.deliver((await request.json()) as Delivered);
      return new Response("ok");
    }

    // ── Creation-time assignment ─────────────────────────────────
    if (url.pathname === "/route" && post) {
      const { channelId } = (await request.json()) as { channelId: string };
      return Response.json(await this.route(channelId));
    }

    // ── Customers connected right now (staff "online" list) ──────
    if (url.pathname === "/online-customers") {
      const staffIds = new Set(
        this.liveSessions()
          .filter((s) => s.state.isStaff)
          .map((s) => s.state.userId),
      );
      const userIds = [
        ...new Set(
          this.liveSessions()
            .map((s) => s.state.userId)
            .filter((id) => !staffIds.has(id)),
        ),
      ];
      return Response.json({ seq: this.presenceSeq, userIds });
    }

    // ── Live staff roster (the REST presence snapshot) ───────────
    if (url.pathname === "/staff") {
      const { type: _type, ...snapshot } = await this.staffFrame();
      return Response.json(snapshot);
    }

    // ── Staff-on-a-call set, pushed by the CallHub ───────────────
    if (url.pathname === "/call-state" && post) {
      const body = (await request.json()) as { inCall?: string[] };
      this.inCall = new Set(body.inCall ?? []);
      await this.ctx.storage.put("inCall", [...this.inCall]);
      await this.broadcastStaffPresence();
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  private async acceptSocket(user: WsUser): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const firstSocket = !this.liveSessions().some((s) => s.state.userId === user.id);
    this.ctx.acceptWebSocket(server);

    // Session state rides on the socket: it survives DO eviction.
    server.serializeAttachment({
      connId: crypto.randomUUID(),
      userId: user.id,
      name: user.fullName,
      role: user.role,
      brandId: user.brandId,
      isStaff: user.isStaff,
      channelId: null,
      connectedAt: Date.now(),
    } satisfies Session);

    this.sendFrame(server, {
      type: "hello",
      userId: user.id,
      name: user.fullName,
      role: user.role,
    });

    if (user.isStaff) {
      this.ctx.waitUntil(this.markPresence(user, true));
      this.ctx.waitUntil(this.broadcastStaffPresence());
    } else if (firstSocket) {
      // Only a customer's first tab is news. The ids say whether this
      // conversation is one a staff list should fetch to show as online.
      this.presenceSeq += 1;
      const seq = this.presenceSeq;
      this.ctx.waitUntil(
        this.openChannelIds(user.id).then((channelIds) =>
          this.broadcastFrame(
            { type: "customer_presence", userId: user.id, online: true, seq, channelIds },
            (s) => s.isStaff,
          ),
        ),
      );
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

  /** The live staff with their chat load, in the shape the pure presence rules rank. */
  private async roster(): Promise<StaffEntry[]> {
    const loads = await activeLoads(this.env.DB);
    const byUser = new Map<string, StaffEntry>();
    for (const { state } of this.liveSessions()) {
      if (!state.isStaff || byUser.has(state.userId)) continue;
      byUser.set(state.userId, {
        userId: state.userId,
        name: state.name,
        role: state.role,
        brandId: state.brandId,
        online: true,
        inCall: this.inCall.has(state.userId),
        activeChats: (loads.get(state.userId) ?? 0) + (this.adminLoad.get(state.userId) ?? 0),
        lastAssignedAt: this.lastAssigned.get(state.userId) ?? null,
        lastSeenAt: new Date().toISOString(),
      });
    }
    return [...byUser.values()];
  }

  private async openChannelIds(userId: string): Promise<string[]> {
    const { results } = await this.env.DB.prepare(
      `SELECT id FROM chat_channel WHERE user_id = ? AND status IN ('open', 'assigned')`,
    )
      .bind(userId)
      .all<{ id: string }>();
    return results.map((r) => r.id);
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

    try {
      switch (String(frame.type ?? "")) {
        case "ping":
          // Fallback for non-exact pings (old clients, test scripts with
          // timestamps): fixed `{"type":"ping"}` frames are answered by the
          // platform auto-response above without waking this DO.
          this.sendFrame(ws, { type: "pong", __server_ts: Date.now() });
          break;
        case "join":
          await this.handleJoin(ws, state, frame);
          break;
        case "leave":
          this.leaveRoom(ws, state);
          break;
        case "message":
          await this.handleMessage(ws, state, frame);
          break;
        case "read":
          await this.handleRead(state, frame);
          break;
        case "typing": {
          const channelId = String(frame.channelId ?? state.channelId ?? "");
          this.broadcastFrame(
            {
              type: "typing",
              channelId,
              userId: state.userId,
              name: state.name,
              isTyping: frame.isTyping !== false,
            },
            (s) => s.connId !== state.connId && s.channelId === channelId,
          );
          break;
        }
        default:
          this.sendFrame(ws, {
            type: "error",
            message: `unknown message type: ${String(frame.type ?? "")}`,
          });
      }
    } catch (e) {
      this.sendFrame(ws, { type: "error", message: e instanceof Error ? e.message : "failed" });
    }
  }

  /** The channel id a frame names; a customer may only touch their own channel. */
  private async channelFor(state: Session, frame: Record<string, unknown>): Promise<string> {
    if (typeof frame.channelId !== "string" || !frame.channelId)
      throw new Error("missing channelId");
    const channel = await getChannel(this.env.DB, frame.channelId);
    // Everything said in a room reaches every socket in it, so a customer is
    // held to their own conversation (the Rust hub trusts the id).
    if (!channel || (!state.isStaff && channel.user_id !== state.userId))
      throw new Error("chat channel not found");
    return channel.id;
  }

  /** `join`: attach the socket to a channel room. */
  private async handleJoin(ws: WebSocket, state: Session, frame: Record<string, unknown>) {
    const channelId = await this.channelFor(state, frame);
    const previous = state.channelId;
    state.channelId = channelId;
    ws.serializeAttachment(state);
    if (previous && previous !== channelId) this.announceRoomPresence(previous, state, false);
    this.broadcastFrame(
      { type: "presence", channelId, userId: state.userId, online: true },
      (s) => s.connId !== state.connId && s.channelId === channelId,
    );

    const roster = await this.roster();
    this.sendFrame(ws, {
      type: "joined",
      channelId,
      userId: state.userId,
      onlineEmployees: onlineCount(roster, state.brandId),
      availableEmployees: availableCount(roster, state.brandId),
      botActive: botActive(roster, state.brandId),
    });
    // Staff get the full live list at once (customers hear botActive only).
    if (state.isStaff) this.sendFrame(ws, await this.staffFrame());
  }

  /** `leave`: the customer closed the support panel but stays signed in. */
  private leaveRoom(ws: WebSocket, state: Session) {
    const previous = state.channelId;
    state.channelId = null;
    ws.serializeAttachment(state);
    if (previous) this.announceRoomPresence(previous, state, false);
  }

  /** Tell a room a user went away, unless another tab of theirs is still in it. */
  private announceRoomPresence(channelId: string, state: Session, online: boolean) {
    const stillThere = this.liveSessions().some(
      (s) =>
        s.connId !== state.connId && s.state.userId === state.userId && s.state.channelId === channelId,
    );
    if (stillThere) return;
    this.broadcastFrame(
      { type: "presence", channelId, userId: state.userId, online },
      (s) => s.channelId === channelId,
    );
  }

  /** `message`: store (idempotent on clientMsgId), fan out, acknowledge the sender. */
  private async handleMessage(ws: WebSocket, state: Session, frame: Record<string, unknown>) {
    const channelId = await this.channelFor(state, frame);
    if (typeof frame.text !== "string") throw new Error("missing text");
    if ([...frame.text].length > MAX_CONTENT_CHARS) throw new Error("content too long");
    const clientMsgId =
      typeof frame.clientMsgId === "string" && frame.clientMsgId ? frame.clientMsgId : null;

    // A retry replays the stored id; nothing is stored or broadcast twice.
    if (clientMsgId) {
      const stored = await findMessageByClientId(this.env.DB, channelId, clientMsgId);
      if (stored) {
        this.sendFrame(ws, { type: "ack", clientMsgId, id: stored.id });
        return;
      }
    }

    let saved: MessageRow;
    try {
      saved = await insertMessage(this.env.DB, {
        channelId,
        senderType: state.isStaff ? "employee" : "user",
        senderId: state.userId,
        content: frame.text,
        clientMsgId,
      });
    } catch (e) {
      const winner = clientMsgId
        ? await findMessageByClientId(this.env.DB, channelId, clientMsgId)
        : null;
      if (!winner) throw e;
      this.sendFrame(ws, { type: "ack", clientMsgId, id: winner.id });
      return;
    }

    await this.deliver({
      id: saved.id,
      channelId,
      senderType: saved.sender_type,
      senderId: state.userId,
      senderName: state.name,
      text: frame.text,
      createdAt: saved.created_at,
      clientMsgId,
    });
    this.sendFrame(ws, { type: "ack", clientMsgId, id: saved.id });
  }

  /** `read`: clear this side's unread badge and tell the room. */
  private async handleRead(state: Session, frame: Record<string, unknown>) {
    const channelId = await this.channelFor(state, frame);
    await clearUnread(this.env.DB, channelId, state.isStaff ? "employee" : "user");
    this.broadcastFrame(
      {
        type: "read",
        channelId,
        userId: state.userId,
        lastReadAt: new Date().toISOString(),
      },
      (s) => s.channelId === channelId,
    );
  }

  /**
   * A stored message: broadcast to the room; for a customer's, decide who
   * owns it and notify them (Rust `handle_message` / `post_message`).
   * Employees' replies go no further than the room.
   */
  private async deliver(m: Delivered) {
    this.broadcastFrame(
      {
        type: "message",
        id: m.id,
        channelId: m.channelId,
        senderType: m.senderType,
        senderId: m.senderId,
        senderName: m.senderName,
        text: m.text,
        ...(m.clientMsgId && { clientMsgId: m.clientMsgId }),
        createdAt: m.createdAt,
      },
      (s) => s.channelId === m.channelId,
    );
    if (m.senderType !== "user") return;

    let outcome: RoutingOutcome;
    try {
      outcome = await this.route(m.channelId);
    } catch (e) {
      console.warn("[chat] routing failed, notifying all staff", e);
      outcome = { kind: "queued" };
    }
    const notify = {
      type: "channel_message",
      channelId: m.channelId,
      senderId: m.senderId,
      senderName: m.senderName,
      preview: [...m.text].slice(0, NOTIFY_PREVIEW_CHARS).join(""),
      createdAt: m.createdAt,
      messageId: m.id,
    };
    const toAdmins = (s: Session) => s.role === "admin";
    switch (outcome.kind) {
      case "assignee":
        this.broadcastFrame(notify, (s) => s.userId === outcome.employeeId || toAdmins(s));
        break;
      case "assigned":
        this.broadcastFrame(notify, (s) => s.userId === outcome.employeeId || toAdmins(s));
        await this.announceAssigned(m.channelId, outcome.employeeId, "employee", "assigned");
        this.broadcastFrame({ type: "channels_changed" }, (s) => s.isStaff);
        break;
      case "admin":
        this.broadcastFrame(notify, toAdmins);
        await this.announceAssigned(m.channelId, outcome.adminId, "admin", "open");
        break;
      default:
        // No specific owner: every staff dashboard sees the queue move.
        this.broadcastFrame(notify, (s) => s.isStaff);
    }
  }

  /** Decide the owner of a customer's message and keep the load bookkeeping. */
  private async route(channelId: string): Promise<RoutingOutcome> {
    const outcome = await routeUserMessage(this.env.DB, channelId, await this.roster());
    const picked =
      outcome.kind === "assigned" ? outcome.employeeId : outcome.kind === "admin" ? outcome.adminId : null;
    if (picked) this.lastAssigned.set(picked, Date.now());
    if (outcome.kind === "admin")
      this.adminLoad.set(outcome.adminId, (this.adminLoad.get(outcome.adminId) ?? 0) + 1);
    return outcome;
  }

  private async announceAssigned(
    channelId: string,
    staffId: string,
    role: "employee" | "admin",
    status: string,
  ) {
    const name =
      (await this.roster()).find((s) => s.userId === staffId)?.name ??
      (role === "admin" ? "Quản trị viên" : "Nhân viên hỗ trợ");
    this.broadcastFrame(
      {
        type: "channel_assigned",
        channelId,
        employeeId: staffId,
        employeeName: name,
        role,
        status,
      },
      (s) => s.channelId === channelId,
    );
  }

  async webSocketClose(ws: WebSocket) {
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
    // `getWebSockets()` still lists a socket that is closing; ignore it by id.
    const others = this.liveSessions().filter((s) => s.connId !== state.connId);
    if (state.channelId) {
      const left = state.channelId;
      if (!others.some((s) => s.state.userId === state.userId && s.state.channelId === left))
        this.broadcastFrame(
          { type: "presence", channelId: left, userId: state.userId, online: false },
          (s) => s.connId !== state.connId && s.channelId === left,
        );
    }
    if (others.some((s) => s.state.userId === state.userId)) return;
    if (state.isStaff) {
      this.ctx.waitUntil(
        this.markPresence(
          { id: state.userId, fullName: state.name, role: state.role, brandId: state.brandId },
          false,
        ).then(() => this.broadcastStaffPresence()),
      );
    } else {
      this.presenceSeq += 1;
      this.broadcastFrame(
        {
          type: "customer_presence",
          userId: state.userId,
          online: false,
          seq: this.presenceSeq,
        },
        (s) => s.isStaff && s.connId !== state.connId,
      );
    }
  }

  /** Write staff presence through to D1 (`staff_presence_state`): the "last seen" the REST roster reads. */
  private async markPresence(
    user: Pick<WsUser, "id" | "fullName" | "role" | "brandId">,
    online: boolean,
  ) {
    try {
      const now = new Date().toISOString();
      await this.env.DB.prepare(
        `INSERT INTO staff_presence_state (user_id, name, role, brand_id, online, last_seen_at, last_online_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           name = excluded.name,
           role = excluded.role,
           brand_id = excluded.brand_id,
           online = excluded.online,
           last_seen_at = excluded.last_seen_at,
           last_online_at = CASE WHEN excluded.online = 1 THEN excluded.last_online_at ELSE last_online_at END`,
      )
        .bind(user.id, user.fullName, user.role, user.brandId, online ? 1 : 0, now, online ? now : null)
        .run();
    } catch (e) {
      console.warn("[chat] presence write failed", e);
    }
  }

  /** The `staff_presence` frame for staff: live roster plus recently-active offline members. */
  private async staffFrame() {
    const roster = await this.roster();
    const since = new Date(Date.now() - OFFLINE_LOOKBACK_MS).toISOString();
    const live = new Set(roster.map((s) => s.userId));
    let offline: unknown[] = [];
    try {
      const { results } = await this.env.DB.prepare(
        `SELECT user_id, name, role, brand_id, last_seen_at, last_online_at FROM staff_presence_state
         WHERE last_seen_at >= ? AND online = 0 ORDER BY last_seen_at DESC LIMIT ?`,
      )
        .bind(since, OFFLINE_LIMIT)
        .all<{
          user_id: string;
          name: string;
          role: string;
          brand_id: string | null;
          last_seen_at: string;
          last_online_at: string | null;
        }>();
      offline = results
        .filter((r) => !live.has(r.user_id))
        .map((r) => ({
          userId: r.user_id,
          name: r.name,
          role: r.role,
          brandId: r.brand_id,
          lastSeenAt: r.last_seen_at,
          lastOnlineAt: r.last_online_at,
        }));
    } catch (e) {
      console.warn("[chat] offline roster failed", e);
    }
    return { type: "staff_presence", ...staffPresenceFrame(roster, null), offline };
  }

  /** Staff hear the whole roster; customers only whether the bot is on duty. */
  private async broadcastStaffPresence() {
    const staff = await this.staffFrame();
    this.broadcastFrame(staff, (s) => s.isStaff);
    const bot = { type: "staff_presence", botActive: staff.botActive };
    this.broadcastFrame(bot, (s) => !s.isStaff);
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
