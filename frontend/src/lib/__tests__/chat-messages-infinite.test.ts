/**
 * Unit tests for `flattenInfiniteMessagePages` — the chat message
 * pagination flattening used by `useChatMessagesInfinite` (admin chat
 * workspace + customer chat widget).
 *
 * The API pages mirror the backend SQL:
 *   SELECT * FROM messages WHERE channel_id = ?
 *   ORDER BY created_at DESC LIMIT 30 OFFSET M
 *
 *   - page 0 (offset 0)  → the 30 NEWEST messages (DESC: newest first)
 *   - page 1 (offset 30) → the NEXT 30 OLDER messages (DESC)
 *
 * The required chat flow (Discord/Slack/Messenger-style):
 *   1. Open channel → render the most recent 30 in chronological order.
 *   2. Scroll to top → fetch offset=30 → the 30 older messages are
 *      PREPENDED to the head of the list (not appended).
 *   3. User/admin sends a message → it is saved to the DB, the first
 *      page refetches, and the new message is APPENDED at the tail
 *      (bottom) of the list.
 */
import { describe, it, expect } from 'vitest'
import { flattenInfiniteMessagePages } from '../queries'

/** Build a DESC page of message stubs: ids newest→oldest. */
const page = (ids: string[]) => ({
  items: ids.map((id) => ({ id, content: `msg ${id}` })),
})

describe('flattenInfiniteMessagePages', () => {
  it('reverses a single page (DESC → chronological) so the newest is last', () => {
    // Channel has 3 messages: m1 oldest … m3 newest. API page 0 is DESC.
    const out = flattenInfiniteMessagePages([page(['m3', 'm2', 'm1'])])
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('PREPENDS the older page to the head of the list (not appended)', () => {
    // 60 messages: m1…m60 (m60 newest).
    // Initial load: page 0 (offset 0) = newest 30 → [m60…m31] DESC.
    const initial = flattenInfiniteMessagePages([page(['m60', 'm59', 'm58'])])
    expect(initial.map((m) => m.id)).toEqual(['m58', 'm59', 'm60'])

    // Scroll-to-top: fetchNextPage appends page 1 (offset 30) =
    // next 30 older → [m30…m1] DESC. pages = [page0, page1].
    const afterLoadMore = flattenInfiniteMessagePages([
      page(['m60', 'm59', 'm58']),
      page(['m30', 'm29', 'm28']),
    ])
    // The older messages must land at the HEAD (prepended)…
    expect(afterLoadMore.slice(0, 3).map((m) => m.id)).toEqual(['m28', 'm29', 'm30'])
    // …and the previously-visible newest messages stay at the TAIL,
    // order preserved.
    expect(afterLoadMore.slice(-3).map((m) => m.id)).toEqual(['m58', 'm59', 'm60'])
    // Full chronological order — no interleaving of old + new chunks.
    expect(afterLoadMore.map((m) => m.id)).toEqual([
      'm28', 'm29', 'm30', 'm58', 'm59', 'm60',
    ])
  })

  it('APPENDS a newly sent message at the tail after the page-0 refetch', () => {
    // The user (or admin) sends m61 → saved to DB → query invalidated →
    // all pages refetch. Offset windows shift forward: page 0 now
    // includes m61; page 1's window slides +1 so it overlaps page 0.
    const out = flattenInfiniteMessagePages([
      page(['m61', 'm60', 'm59']), // refetched page 0 (offset 0) with the new message
      page(['m59', 'm58', 'm57']), // refetched page 1 (offset 3) — overlaps at m59
    ])
    // Newest message (m61) is at the END — appended at the bottom,
    // after the existing messages.
    expect(out[out.length - 1].id).toBe('m61')
    // Overlap (m59 appears in both pages) renders exactly once.
    expect(out.filter((m) => m.id === 'm59')).toHaveLength(1)
    expect(out.map((m) => m.id)).toEqual(['m57', 'm58', 'm59', 'm60', 'm61'])
  })

  it('keeps three+ pages in strict chronological order across all of them', () => {
    const out = flattenInfiniteMessagePages([
      page(['m9', 'm8', 'm7']),
      page(['m6', 'm5', 'm4']),
      page(['m3', 'm2', 'm1']),
    ])
    expect(out.map((m) => m.id)).toEqual([
      'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9',
    ])
  })

  it('handles empty + missing pages without throwing', () => {
    expect(flattenInfiniteMessagePages([])).toEqual([])
    expect(flattenInfiniteMessagePages([undefined, null])).toEqual([])
    expect(flattenInfiniteMessagePages([{ items: [] }])).toEqual([])
  })
})
