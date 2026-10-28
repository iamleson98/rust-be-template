/**
 * Staff presence rules — port of `presence/mod.rs` (the pure part): who is
 * "available", who gets the next chat, when the bot would answer. The live
 * entries come from the ChatHub (sockets) and the DB (assignment load); this
 * file only ranks them.
 */

export interface StaffEntry {
  userId: string;
  name: string;
  /** `employee` or `admin`: admins are full support agents too. */
  role: string;
  /** Brand scope; null = global staff, who serve every brand. */
  brandId: string | null;
  /** At least one live socket (chat or call). */
  online: boolean;
  /** On an answered audio call. */
  inCall: boolean;
  /** Channels assigned to (or implicitly owned by) this member. */
  activeChats: number;
  /** When last picked for an assignment (ms): the round-robin tie-break. */
  lastAssignedAt: number | null;
  lastSeenAt: string;
}

/** Online and not in a call. Chat load only scores, it never disqualifies. */
export const isAvailable = (s: StaffEntry): boolean => s.online && !s.inCall;

/** Global staff serve every brand; a brand-less query sees everyone. */
export function servesBrand(s: StaffEntry, brandId: string | null): boolean {
  if (s.brandId === null) return true;
  return brandId === null || s.brandId === brandId;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Rust `StaffEntry::availability_cmp` (lower sorts first): chat load →
 * least recently assigned (never assigned first) → employees before
 * admins → name.
 */
export function availabilityCmp(a: StaffEntry, b: StaffEntry): number {
  return (
    a.activeChats - b.activeChats ||
    (a.lastAssignedAt ?? -1) - (b.lastAssignedAt ?? -1) ||
    Number(a.role === "admin") - Number(b.role === "admin") ||
    cmp(a.name, b.name)
  );
}

export const inScope = (staff: StaffEntry[], brandId: string | null): StaffEntry[] =>
  staff.filter((s) => servesBrand(s, brandId));

export const onlineCount = (staff: StaffEntry[], brandId: string | null): number =>
  inScope(staff, brandId).filter((s) => s.online).length;

export const availableCount = (staff: StaffEntry[], brandId: string | null): number =>
  inScope(staff, brandId).filter(isAvailable).length;

/** The bot owns support only while nobody at all is online. */
export const botActive = (staff: StaffEntry[], brandId: string | null): boolean =>
  onlineCount(staff, brandId) === 0;

/** Rust `pick_best_available`: the most available person, or none. */
export function pickBestAvailable(staff: StaffEntry[], brandId: string | null): StaffEntry | null {
  return inScope(staff, brandId).filter(isAvailable).sort(availabilityCmp)[0] ?? null;
}

/** The `staff_presence` frame / `GET /api/presence/staff` payload (live part). */
export function staffPresenceFrame(staff: StaffEntry[], brandId: string | null) {
  const list = inScope(staff, brandId).sort(
    (a, b) => Number(b.online) - Number(a.online) || cmp(a.name, b.name),
  );
  return {
    staff: list.map((s) => ({
      userId: s.userId,
      name: s.name,
      role: s.role,
      brandId: s.brandId,
      online: s.online,
      available: isAvailable(s),
      busy: s.inCall,
      inCall: s.inCall,
      activeChats: s.activeChats,
      lastSeenAt: s.lastSeenAt,
    })),
    onlineCount: onlineCount(staff, brandId),
    availableCount: availableCount(staff, brandId),
    botActive: botActive(staff, brandId),
  };
}

/** How a customer message is handled once the channel's owner is decided. */
export type RoutingOutcome =
  /** The channel's assignee is online. */
  | { kind: "assignee"; employeeId: string }
  /** Just auto-assigned to this employee. */
  | { kind: "assigned"; employeeId: string }
  /** The most available person was an admin: no assignment row, admins see everything. */
  | { kind: "admin"; adminId: string }
  /** Nobody is online: the bot owns the exchange. */
  | { kind: "bot" }
  /** Staff are online but all in calls, or the channel is closed. */
  | { kind: "queued" };
