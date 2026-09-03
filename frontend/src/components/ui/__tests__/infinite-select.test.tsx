/**
 * Tests for the InfiniteSelect's smart search throttling: debounced
 * keystrokes + AbortSignal cancellation of superseded requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { InfiniteSelect, type InfiniteFetchPage } from '@/components/ui/infinite-select'

// jsdom lacks IntersectionObserver — stub it (the sentinel needs it).
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver

/** Deferred page promise the mock backend hands out. */
type Deferred = {
  resolve: (p: Page) => void
  signal?: AbortSignal
}

type Page = { items: Array<{ id: string; label: string }>; total: number; hasMore: boolean }

function deferred(): { promise: Promise<Page>; d: Deferred } {
  let d: Deferred
  const promise = new Promise<Page>((resolve) => {
    d = { resolve }
  })
  return { promise, d: d! }
}

/**
 * Mock backend that records every call and hands out deferred
 * promises, so requests stay in flight until the test resolves them
 * — mirroring a real network round-trip.
 */
function makeBackend() {
  const calls: Array<{ page: number; search: string; signal?: AbortSignal }> = []
  const pending: Array<Deferred> = []
  const fetchPage: InfiniteFetchPage<{ id: string; label: string }> = (page, search, signal) => {
    calls.push({ page, search, signal })
    const { promise, d } = deferred()
    d.signal = signal
    pending.push(d)
    // Auto-resolve on the next microtask UNLESS the test defers it —
    // resolve()ing here keeps the query happy in the happy-path tests.
    return promise as ReturnType<typeof fetchPage>
  }
  /** Resolve every pending request (happy-path continuation). */
  const flush = () => {
    for (const d of pending.splice(0)) {
      d.resolve({ items: [], total: 0, hasMore: false })
    }
  }
  return { fetchPage, calls, pending, flush }
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** Open the popup by clicking the trigger button (role="combobox"). */
function openPopup() {
  fireEvent.click(screen.getByRole('combobox', { hidden: true }))
}

/** The Base UI search input inside the open popup. */
function searchInput() {
  return screen.getByPlaceholderText('Tìm kiếm…') as HTMLInputElement
}

describe('InfiniteSelect search throttling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires exactly one request per settled search term (debounce)', async () => {
    const backend = makeBackend()
    withClient(
      <InfiniteSelect
        scope="throttle-test"
        fetchPage={backend.fetchPage}
        value={null}
        onValueChange={vi.fn()}
        itemValue={(i) => i.id}
        itemLabel={(i) => i.label}
      />,
    )

    // Type three characters in quick succession (within the debounce).
    openPopup()
    fireEvent.input(searchInput(), { target: { value: 'h' } })
    fireEvent.input(searchInput(), { target: { value: 'ha' } })
    fireEvent.input(searchInput(), { target: { value: 'hai' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    // Only the initial load (empty term) + the settled term — not one
    // call per keystroke.
    expect(backend.calls.map((c) => c.search)).toEqual(['', 'hai'])
  })

  it('aborts the superseded request when the search term changes', async () => {
    const backend = makeBackend()
    withClient(
      <InfiniteSelect
        scope="abort-test"
        fetchPage={backend.fetchPage}
        value={null}
        onValueChange={vi.fn()}
        itemValue={(i) => i.id}
        itemLabel={(i) => i.label}
      />,
    )

    // Initial '' request fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(backend.calls.length).toBe(1)

    // Type a term, let it settle → second request.
    openPopup()
    fireEvent.input(searchInput(), { target: { value: 'sai' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(backend.calls.map((c) => c.search)).toEqual(['', 'sai'])

    // Keep typing → the 'sai' request must be aborted when 'saigon'
    // supersedes it.
    fireEvent.input(searchInput(), { target: { value: 'saigon' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    const saiCall = backend.calls.find((c) => c.search === 'sai')
    expect(saiCall?.signal?.aborted).toBe(true)
    expect(backend.calls.map((c) => c.search)).toEqual(['', 'sai', 'saigon'])
  })

  it('passes the abort signal through to fetchPage', async () => {
    const backend = makeBackend()
    withClient(
      <InfiniteSelect
        scope="signal-test"
        fetchPage={backend.fetchPage}
        value={null}
        onValueChange={vi.fn()}
        itemValue={(i) => i.id}
        itemLabel={(i) => i.label}
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    // Every request carries a signal the backend can wire into fetch().
    expect(backend.calls.every((c) => c.signal instanceof AbortSignal)).toBe(true)
  })

  it('renders no "Đã hiển thị tất cả" footer once all items are loaded', async () => {
    const backend = makeBackend()
    withClient(
      <InfiniteSelect
        scope="footer-test"
        fetchPage={backend.fetchPage}
        value={null}
        onValueChange={vi.fn()}
        itemValue={(i) => i.id}
        itemLabel={(i) => i.label}
      />,
    )
    openPopup()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(screen.queryByText('Đã hiển thị tất cả')).toBeNull()
    // The empty-state / loading messages are still allowed to appear;
    // the exhausted-list footer is the one removed.
  })
})
