import type { AdminChannel as Channel } from '@/features/admin/dashboard/types'

/**
 * Pick the best customer-facing label for a channel row.
 *
 * Order of preference:
 *   1. `user.fullName` — set on signup, always present for real users.
 *   2. `user.email` — fallback when fullName is empty.
 *   3. `user.phone` — fallback when both fullName + email are empty.
 *   4. `topic` — the channel topic, e.g. "Hỗ trợ".
 *   5. `"Khách"` — generic Vietnamese for "Customer" (last-resort default).
 */
export function customerDisplayName(channel: Channel): string {
  const u = channel.user
  if (u?.fullName && u.fullName.trim().length > 0) return u.fullName
  if (u?.email && u.email.trim().length > 0) return u.email
  if (u?.phone && u.phone.trim().length > 0) return u.phone
  if (channel.topic && channel.topic.trim().length > 0) return channel.topic
  return 'Khách'
}

/** First letter of the customer's display name (for the avatar fallback). */
export function customerInitial(channel: Channel): string {
  const name = customerDisplayName(channel)
  return (name && name[0]?.toUpperCase()) || 'K'
}

/**
 * Build a subtitle line for the channel row — shows email or phone
 * (whichever is present + different from the display name). Empty
 * string when no extra info is available.
 */
export function customerSubtitle(channel: Channel): string {
  const u = channel.user
  const name = customerDisplayName(channel)
  // Prefer phone (more actionable for support), then email.
  if (u?.phone && u.phone.trim().length > 0 && u.phone !== name) return u.phone
  if (u?.email && u.email.trim().length > 0 && u.email !== name) return u.email
  return ''
}

// ────────────────────────────────────────────────────────────────
//  Message rendering: timestamps + day separators + virtualization
// ────────────────────────────────────────────────────────────────

/** `HH:mm` (vi-VN, 24h) for a message timestamp. */
export function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

/** Day key (`YYYY-M-D` in local time) for day-boundary detection. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * Day-separator label ("Hôm nay" / "Hôm qua" / `dd/MM/yyyy`) shown
 * between messages from different calendar days.
 */
export function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((today - that) / 86_400_000)
  if (diffDays === 0) return 'Hôm nay'
  if (diffDays === 1) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Decide whether a separator is needed before this message: when the
 * previous message (chronological) is from a different calendar day
 * (or there is no previous message). Returns the label, or null.
 */
export function daySeparatorLabel(prevIso: string | null | undefined, iso: string): string | null {
  if (!iso) return null
  if (!prevIso || dayKey(prevIso) !== dayKey(iso)) return formatDayLabel(iso)
  return null
}

// Aligned height for the channel list + chat workspace. Both panes
// are capped so the split view looks symmetric + each pane scrolls
// internally when content overflows.
//
// IMPORTANT: use `h-[32rem]` (fixed height), NOT `max-h-[32rem]`.
// `max-h` on the ScrollArea root doesn't propagate to the Viewport
// (which is `size-full` = height:100%) — the viewport would grow
// with its content + never scroll. `h-[32rem]` forces the root to
// a fixed height → the viewport constrains to that height →
// overflow scrolls. This was the "channel list doesn't scroll
// when overflow" bug.
//
// On base screens the two cards stack (grid-cols-1) + their heights
// are indefinite (content-driven), so BOTH panes need the definite
// `h-[32rem]`. At `xl` BOTH cards get the same definite height
// (`xl:h-[40rem]` on each Card) — the panes then FILL their card's
// remaining space (`xl:h-full` / `xl:flex-1 + xl:min-h-0`), which is
// what keeps the chat box + its header capped to the same total
// height as the channel-list card (Slack/Intercom-style symmetric
// split view). A `flex-1` pane inside an INDEFINITE-height card
// would instead grow the card to the FULL message history height —
// the "chat box much larger than the channel list" bug — so
// `flex-1` is xl-only, never at base. (The definite height must
// live on the CARDS: an `auto` grid row still sizes to the items'
// content, so a height on the grid container alone doesn't cap
// anything.)
export const PANES_HEIGHT = 'h-[32rem]'
