/**
 * Unit tests for `tripSearchNextPageParam` — the pagination cursor of
 * `useTripSearchInfinite` (the search results page's "load more"
 * button).
 *
 * The contract mirrors the backend's paginated search responses
 * (`/api/search` and `/api/search/geo` share the shape):
 *
 *   { items: TripResult[], total?, limit?, offset?, hasMore? }
 *
 *   - `hasMore: true`  → the NEXT page starts at `offset + limit`
 *   - `hasMore: false` → `undefined` (the sequence ends — no button)
 *   - missing metadata (older backend / unpaginated endpoint) →
 *     treated as "no more pages" (never guess a cursor)
 *
 * Determinism matters: the backend sorts every page with the same
 * comparator (+ trip_id tie-break), so consecutive offsets tile the
 * ranked list without gaps or duplicates.
 */
import { describe, it, expect } from 'vitest'
import { TRIP_SEARCH_PAGE_SIZE, tripSearchNextPageParam } from '../queries'
import type { TripSearchResponse } from '@/lib/api/types.gen'

/** Minimal page stub — only the pagination metadata matters here. */
const page = (over: Partial<TripSearchResponse>): TripSearchResponse =>
  ({ items: [], ...over }) as TripSearchResponse

describe('tripSearchNextPageParam', () => {
  it('ends the sequence when hasMore is false', () => {
    expect(
      tripSearchNextPageParam(page({ total: 3, limit: 10, offset: 0, hasMore: false })),
    ).toBeUndefined()
  })

  it('ends the sequence when hasMore is missing (unpaginated response)', () => {
    // /api/recommendations-style responses carry no metadata at all —
    // the cursor must NOT invent an offset and re-request.
    expect(tripSearchNextPageParam(page({}))).toBeUndefined()
    expect(
      tripSearchNextPageParam(page({ total: 5, limit: 10, offset: 0, hasMore: null })),
    ).toBeUndefined()
  })

  it('advances by offset + limit while hasMore is true', () => {
    // 25 trips, pages of 10: 0 → 10 → 20.
    expect(tripSearchNextPageParam(page({ total: 25, limit: 10, offset: 0, hasMore: true }))).toBe(
      10,
    )
    expect(tripSearchNextPageParam(page({ total: 25, limit: 10, offset: 10, hasMore: true }))).toBe(
      20,
    )
  })

  it('ends after the LAST partial page clears hasMore', () => {
    // 25 trips: page at offset 20 returns 5 items and hasMore false.
    expect(
      tripSearchNextPageParam(page({ total: 25, limit: 10, offset: 20, hasMore: false })),
    ).toBeUndefined()
  })

  it('falls back to the default page size when limit is missing or invalid', () => {
    expect(tripSearchNextPageParam(page({ total: 99, offset: 0, hasMore: true }))).toBe(
      TRIP_SEARCH_PAGE_SIZE,
    )
    expect(tripSearchNextPageParam(page({ total: 99, offset: 40, limit: 0, hasMore: true }))).toBe(
      40 + TRIP_SEARCH_PAGE_SIZE,
    )
    // Negative/NaN limits are ignored too (corrupt response guard).
    expect(tripSearchNextPageParam(page({ total: 99, offset: 40, limit: -5, hasMore: true }))).toBe(
      40 + TRIP_SEARCH_PAGE_SIZE,
    )
  })

  it('treats a missing offset as 0 (first page)', () => {
    expect(tripSearchNextPageParam(page({ total: 99, limit: 10, hasMore: true }))).toBe(10)
  })

  it('never re-issues the same offset (degenerate-corrupt page guard)', () => {
    // limit 0 with a bogus hasMore — the naive offset+limit math would
    // return the SAME offset forever, spinning the client in a loop.
    expect(tripSearchNextPageParam(page({ total: 99, offset: 0, limit: 0, hasMore: true }))).toBe(
      TRIP_SEARCH_PAGE_SIZE,
    ) // falls back to the default size…
    // …but if even that degenerates (offset already huge), stop:
    expect(
      tripSearchNextPageParam(
        page({ total: Number.NaN, offset: Number.POSITIVE_INFINITY, hasMore: true }),
      ),
    ).toBeUndefined()
  })
})
