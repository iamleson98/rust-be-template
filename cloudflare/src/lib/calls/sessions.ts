/**
 * Call session state machine — the port of the Rust `audio_call::session`.
 *
 * Pure data and rules, no Cloudflare APIs: the Durable Object (call-hub.ts)
 * owns sockets and persistence, this owns "who is calling whom, and what may
 * happen next". Keeping it free of I/O is what makes the tricky cases —
 * escalation, answered-elsewhere, resume after a network switch — unit
 * testable (tests/unit/call-sessions.test.ts).
 *
 * A session is keyed by the CUSTOMER's user id: a customer is in at most one
 * call, and the customer side of every call (whoever dialled) is that key.
 *
 *   ringing ──answer──► active ──hangup/drop──► (removed)
 *      │                  │
 *      │ decline/timeout  └─ carrying socket dropped → grace window → resume or end
 *      └─► next agent (customer-initiated) or removed
 */

export type CallRole = "customer" | "agent";
export type SessionState = "ringing" | "active";

export interface CallerProfile {
  name: string | null;
  avatar: string | null;
}

export interface CallSession {
  customerId: string;
  /** The agent currently rung / on the call. */
  agentId: string;
  initiator: CallRole;
  state: SessionState;
  /** The original offer SDP, kept so escalation and re-delivery can resend it. */
  offer: unknown;
  channelId: string | null;
  caller: CallerProfile;
  /** Agents already rung for this call: escalation never re-rings them. */
  rang: string[];
  createdAt: number;
  /** Start of the CURRENT ring window (resets on each escalation). */
  ringStartedAt: number;
  answeredAt: number | null;
  /** Socket that sent the offer. */
  offererConn: string | null;
  /** Socket that answered (only meaningful once active). */
  answeredConn: string | null;
  /** While set, the carrying socket is gone and the call awaits a resume. */
  graceUntil: number | null;
  /** Whose socket dropped (the party the grace window is waiting for). */
  graceUser: string | null;
}

/** Picks an agent user id that is online and not in `exclude`, or null. */
export type PickAgent = (exclude: ReadonlySet<string>) => string | null;

export type OfferOutcome =
  | { kind: "ringing"; agentId: string }
  | { kind: "customer-busy" }
  | { kind: "no-agent" }
  | { kind: "peer-busy" }
  | { kind: "agent-busy" };

export type AgentHangupOutcome =
  | { kind: "none" }
  | { kind: "rerouted"; customerId: string; agentId: string }
  | { kind: "notify"; customerId: string; reason: string };

export type CustomerHangupOutcome =
  { kind: "none" } | { kind: "notify-agent"; agentId: string; wasActive: boolean };

/** A session that ended because a socket (or its grace window) ran out. */
export interface EndedSession {
  customerId: string;
  agentId: string;
  /** The user whose socket dropped. */
  droppedUserId: string;
  /** The other party, who must be told. */
  notifyUserId: string;
}

export class CallSessions {
  private readonly byCustomer = new Map<string, CallSession>();

  constructor(initial: CallSession[] = []) {
    for (const s of initial) this.byCustomer.set(s.customerId, { ...s, rang: [...s.rang] });
  }

  /** Plain data for persistence (Durable Object storage). */
  snapshot(): CallSession[] {
    return [...this.byCustomer.values()].map((s) => ({ ...s, rang: [...s.rang] }));
  }

  get size(): number {
    return this.byCustomer.size;
  }

  get(customerId: string): CallSession | undefined {
    return this.byCustomer.get(customerId);
  }

  all(): CallSession[] {
    return [...this.byCustomer.values()];
  }

  /** Every agent that is ringing or on a call. */
  busyAgents(): Set<string> {
    return new Set(this.all().map((s) => s.agentId));
  }

  agentBusy(agentId: string): boolean {
    return this.all().some((s) => s.agentId === agentId);
  }

  /** True while any agent is on an ANSWERED call (drives `agentInCall`). */
  anyAgentInCall(): boolean {
    return this.all().some((s) => s.state === "active");
  }

  /** The session `userId` takes part in, as customer or as agent. */
  ofUser(userId: string): CallSession | undefined {
    return this.byCustomer.get(userId) ?? this.all().find((s) => s.agentId === userId);
  }

  /** The ringing customer-initiated session aimed at this agent, if any. */
  ringingFor(agentId: string): CallSession | undefined {
    return this.all().find(
      (s) => s.agentId === agentId && s.state === "ringing" && s.initiator === "customer",
    );
  }

  // ── Offers ─────────────────────────────────────────────────────────

  beginCustomerOffer(
    customerId: string,
    offer: unknown,
    channelId: string | null,
    connId: string | null,
    caller: CallerProfile,
    pick: PickAgent,
    now: number,
  ): OfferOutcome {
    if (this.byCustomer.has(customerId)) return { kind: "customer-busy" };
    const agentId = pick(this.busyAgents());
    if (!agentId) return { kind: "no-agent" };
    this.byCustomer.set(customerId, {
      customerId,
      agentId,
      initiator: "customer",
      state: "ringing",
      offer,
      channelId,
      caller,
      rang: [agentId],
      createdAt: now,
      ringStartedAt: now,
      answeredAt: null,
      offererConn: connId,
      answeredConn: null,
      graceUntil: null,
      graceUser: null,
    });
    return { kind: "ringing", agentId };
  }

  beginAgentOffer(
    agentId: string,
    customerId: string,
    offer: unknown,
    channelId: string | null,
    connId: string | null,
    caller: CallerProfile,
    now: number,
  ): OfferOutcome {
    if (this.byCustomer.has(customerId)) return { kind: "peer-busy" };
    if (this.agentBusy(agentId)) return { kind: "agent-busy" };
    this.byCustomer.set(customerId, {
      customerId,
      agentId,
      initiator: "agent",
      state: "ringing",
      offer,
      channelId,
      caller,
      rang: [agentId],
      createdAt: now,
      ringStartedAt: now,
      answeredAt: null,
      offererConn: connId,
      answeredConn: null,
      graceUntil: null,
      graceUser: null,
    });
    return { kind: "ringing", agentId };
  }

  /**
   * The callee accepted. Valid only for a RINGING session between exactly this
   * pair; a stale or duplicate answer returns null and must be dropped so it
   * cannot fabricate a call.
   */
  onAnswer(
    agentId: string,
    customerId: string,
    connId: string | null,
    now: number,
  ): CallSession | null {
    const s = this.byCustomer.get(customerId);
    if (!s || s.agentId !== agentId || s.state !== "ringing") return null;
    s.state = "active";
    s.answeredAt = now;
    s.answeredConn = connId;
    s.graceUntil = null;
    s.graceUser = null;
    return s;
  }

  // ── Routing ────────────────────────────────────────────────────────

  /** The agent paired with this customer (any state). */
  agentFor(customerId: string): string | null {
    return this.byCustomer.get(customerId)?.agentId ?? null;
  }

  /** `customerId` if (and only if) this agent is paired with that customer. */
  agentTarget(agentId: string, customerId: string): string | null {
    const s = this.byCustomer.get(customerId);
    return s && s.agentId === agentId ? customerId : null;
  }

  // ── Hangups ────────────────────────────────────────────────────────

  onCustomerHangup(customerId: string): CustomerHangupOutcome {
    const s = this.byCustomer.get(customerId);
    if (!s) return { kind: "none" };
    this.byCustomer.delete(customerId);
    return { kind: "notify-agent", agentId: s.agentId, wasActive: s.state === "active" };
  }

  /**
   * An agent declined / hung up / timed out / went offline. Handles ONE
   * session (callers loop until `none`): a ringing customer-initiated call
   * escalates to the next free agent instead of dying; everything else ends.
   */
  onAgentHangup(agentId: string, reason: string, pick: PickAgent, now: number): AgentHangupOutcome {
    const s = this.all().find((x) => x.agentId === agentId && x.graceUntil === null);
    if (!s) return { kind: "none" };
    if (s.state === "ringing" && s.initiator === "customer") {
      const exclude = new Set([...s.rang, ...this.busyAgents()]);
      const next = pick(exclude);
      if (next) {
        s.agentId = next;
        s.rang.push(next);
        s.ringStartedAt = now;
        return { kind: "rerouted", customerId: s.customerId, agentId: next };
      }
    }
    this.byCustomer.delete(s.customerId);
    return { kind: "notify", customerId: s.customerId, reason };
  }

  // ── Sockets ────────────────────────────────────────────────────────

  private isParty(s: CallSession, userId: string): boolean {
    return s.customerId === userId || s.agentId === userId;
  }

  /** Does this socket currently carry the user's side of a call? */
  socketCarriesCall(userId: string, connId: string): boolean {
    return this.all().some(
      (s) =>
        this.isParty(s, userId) &&
        (s.offererConn === connId || (s.state === "active" && s.answeredConn === connId)),
    );
  }

  socketCarriesActiveCall(userId: string, connId: string): boolean {
    return this.all().some(
      (s) =>
        this.isParty(s, userId) &&
        s.state === "active" &&
        (s.offererConn === connId || s.answeredConn === connId),
    );
  }

  /**
   * The user reconnected with their call still running (a network switch:
   * new address, new socket) and asked to resume it. From now on THIS socket
   * carries their side, so the old socket's late drop no longer ends the
   * call. Returns whether a call was taken over.
   */
  resumeOnSocket(userId: string, connId: string): boolean {
    for (const s of this.all()) {
      if (!this.isParty(s, userId)) continue;
      const isCustomer = s.customerId === userId;
      const isOfferer = (s.initiator === "customer") === isCustomer;
      if (isOfferer) {
        s.offererConn = connId;
        s.graceUntil = null;
        s.graceUser = null;
        return true;
      }
      if (s.state === "active" && s.answeredConn !== null) {
        s.answeredConn = connId;
        s.graceUntil = null;
        s.graceUser = null;
        return true;
      }
      return false;
    }
    return false;
  }

  /**
   * A socket dropped. Removes every session it carried and reports who to
   * tell. A socket that is not the carrier of anything (a second device, a
   * tab) leaves the call untouched.
   */
  endSessionsOfSocket(userId: string, connId: string): EndedSession[] {
    const ended: EndedSession[] = [];
    for (const s of this.all()) {
      if (!this.isParty(s, userId)) continue;
      const carries =
        s.offererConn === connId || (s.state === "active" && s.answeredConn === connId);
      // A call in its resume grace window is the alarm's to end, not the drop's.
      if (!carries || s.graceUntil !== null) continue;
      this.byCustomer.delete(s.customerId);
      ended.push({
        customerId: s.customerId,
        agentId: s.agentId,
        droppedUserId: userId,
        notifyUserId: userId === s.customerId ? s.agentId : s.customerId,
      });
    }
    return ended;
  }

  /**
   * Give ANSWERED calls the dropped socket carried a grace window instead of
   * ending them: a Wi-Fi ↔ 4G switch kills the socket while the audio still
   * flows peer to peer, and the client reconnects and resumes. Returns how
   * many calls entered grace.
   */
  startGrace(userId: string, connId: string, until: number): number {
    let n = 0;
    for (const s of this.all()) {
      if (!this.isParty(s, userId) || s.state !== "active") continue;
      if (s.offererConn !== connId && s.answeredConn !== connId) continue;
      s.graceUntil = until;
      s.graceUser = userId;
      n++;
    }
    return n;
  }

  /** Sessions whose grace window ran out without a resume. */
  endExpiredGrace(now: number): EndedSession[] {
    const ended: EndedSession[] = [];
    for (const s of this.all()) {
      if (s.graceUntil === null || s.graceUntil > now) continue;
      this.byCustomer.delete(s.customerId);
      const dropped = s.graceUser ?? s.customerId;
      ended.push({
        customerId: s.customerId,
        agentId: s.agentId,
        droppedUserId: dropped,
        notifyUserId: dropped === s.customerId ? s.agentId : s.customerId,
      });
    }
    return ended;
  }

  // ── Janitor ────────────────────────────────────────────────────────

  /** Ringing sessions whose current ring window has run out. */
  ringExpired(now: number, ringMs: number): CallSession[] {
    return this.all().filter((s) => s.state === "ringing" && now - s.ringStartedAt >= ringMs);
  }

  /** Active sessions older than the maximum call length. */
  overlong(now: number, maxMs: number): CallSession[] {
    return this.all().filter(
      (s) => s.state === "active" && s.answeredAt !== null && now - s.answeredAt >= maxMs,
    );
  }

  remove(customerId: string): CallSession | undefined {
    const s = this.byCustomer.get(customerId);
    this.byCustomer.delete(customerId);
    return s;
  }

  /** Earliest moment something needs attention (for the Durable Object alarm). */
  nextDeadline(ringMs: number, maxMs: number): number | null {
    let next: number | null = null;
    const consider = (t: number) => {
      if (next === null || t < next) next = t;
    };
    for (const s of this.all()) {
      if (s.graceUntil !== null) consider(s.graceUntil);
      if (s.state === "ringing") consider(s.ringStartedAt + ringMs);
      else if (s.answeredAt !== null) consider(s.answeredAt + maxMs);
    }
    return next;
  }
}
