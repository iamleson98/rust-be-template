import type { ChatChannelOut } from '@/api'

/** The newest `customer_presence` event seen per customer. */
export type PresenceEvents = ReadonlyMap<string, { online: boolean; seq: number }>

type Snapshot = { seq: number; userIds: string[] }

/**
 * Customers online right now (signed in with the site open): the
 * `GET /api/chat/channels/online` snapshot, corrected by the live events newer
 * than it. Snapshot and events carry the hub's presence sequence number — a
 * page refresh closes one socket and opens another within milliseconds, and
 * the two events (or an event and the snapshot) can arrive in either order —
 * so the higher number wins.
 */
export function onlineUsers(snapshot: Snapshot | undefined, events: PresenceEvents) {
  const since = snapshot?.seq ?? 0
  const online = new Set(snapshot?.userIds)
  for (const [userId, e] of events) {
    if (e.seq <= since) continue
    if (e.online) online.add(userId)
    else online.delete(userId)
  }
  return online
}

/**
 * `events` with this one recorded, unless an equal or newer one for the same
 * customer is already there. Entries the snapshot (`since`) already covers are
 * dropped, so the map stays as small as the churn since the last snapshot.
 */
export function withPresenceEvent(
  events: PresenceEvents,
  event: { userId: string; online: boolean; seq: number },
  since = 0,
): PresenceEvents {
  const prev = events.get(event.userId)
  if (event.seq <= since || (prev && prev.seq >= event.seq)) return events
  const next = new Map([...events].filter(([, e]) => e.seq > since))
  next.set(event.userId, { online: event.online, seq: event.seq })
  return next
}

const activity = (c: ChatChannelOut) => (c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0) || 0
const newestFirst = (a: ChatChannelOut, b: ChatChannelOut) => activity(b) - activity(a)

/**
 * The staff list: every known channel once (the loaded pages plus the online
 * customers' channels, which may not be loaded yet), online customers first,
 * each group most recent activity first. `onlineCount` is where the online
 * group ends.
 */
export function onlineFirst(
  pages: readonly ChatChannelOut[],
  onlineChannels: readonly ChatChannelOut[],
  online: ReadonlySet<string>,
) {
  const byId = new Map(pages.map((c) => [c.id, c]))
  for (const c of onlineChannels) byId.set(c.id, c)
  const all = [...byId.values()]
  const first = all.filter((c) => online.has(c.userId)).sort(newestFirst)
  const rest = all.filter((c) => !online.has(c.userId)).sort(newestFirst)
  return { channels: [...first, ...rest], onlineCount: first.length }
}
