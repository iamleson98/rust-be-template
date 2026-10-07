import { expect, test } from '@playwright/test'

/**
 * Search pagination — the "load more" contract, end-to-end against the
 * real /search page (dev server, mocked API via page.route).
 *
 * The backend contract being pinned (mirrors the Rust integration test
 * `search_paginates_with_offset_and_has_more`):
 *
 *   GET /api/search?from&to&date&limit&offset
 *   → { items, total, limit, offset, hasMore }
 *
 *   - page 1 renders immediately (limit-sized)
 *   - `hasMore: true` → the load-more button shows "N more"
 *   - clicking it requests `offset += limit` and APPENDS the page
 *   - the last page clears `hasMore` → the button disappears
 *
 * No backend needed: every /api/* call is intercepted; /api/search is
 * served from an in-memory 25-trip fixture paginated exactly like the
 * Rust service (sort by departure, offset slicing, trip_id tie-break).
 */

const DATE = '2026-10-20'
const PAGE_SIZE = 10
const TOTAL_TRIPS = 25

/** Build a full TripResult stub — only the fields the card renders. */
function trip(i: number) {
  const hh = String(6 + Math.floor(i / 3)).padStart(2, '0')
  const mm = String((i * 7) % 60).padStart(2, '0')
  return {
    tripId: `trip-${i}`,
    scheduleId: `sched-${i}`,
    routeId: `route-${Math.floor(i / 5)}`,
    routeName: `Mock Route ${Math.floor(i / 5)}`,
    brandId: `brand-${Math.floor(i / 5)}`,
    brandName: `Mock Bus ${Math.floor(i / 5)}`,
    brandSlug: `mock-bus-${Math.floor(i / 5)}`,
    brandLogo: null,
    brandRating: 4.5,
    brandAccent: '#0d9488',
    fromName: 'Hà Nội',
    fromLat: 21.0287,
    fromLon: 105.8524,
    toName: 'Đà Nẵng',
    toLat: 16.0544,
    toLon: 108.2022,
    departureDate: DATE,
    departureTime: `${hh}:${mm}`,
    departureAt: `${DATE}T${hh}:${mm}:00+07:00`,
    arrivalAt: `${DATE}T${String(Number(hh) + 12).padStart(2, '0')}:${mm}:00+07:00`,
    availableSeats: 12 + (i % 9),
    totalSeats: 28,
    status: 'scheduled',
    minPrice: 200000 + i * 10000,
    maxPrice: 200000 + i * 10000,
    priceAdult: 200000 + i * 10000,
    priceChild: 100000,
    vehicleType: 'limousine',
    vehicleTypeLabel: 'Limousine',
    busLayoutId: null,
    capacity: 28,
    amenities: ['wifi', 'water'],
  }
}

/** The server-side page slicing the Rust service performs. */
function servePage(offset: number, limit: number) {
  const items = Array.from({ length: TOTAL_TRIPS }, (_, i) => trip(i))
    .slice(offset, offset + limit)
    .map((t) => ({ ...t, tripId: `${t.tripId}` }))
  const hasMore = offset + items.length < TOTAL_TRIPS
  return {
    items,
    total: TOTAL_TRIPS,
    limit,
    offset,
    hasMore,
  }
}

/** Intercept every real API call: /api/search is served from the fixture
 *  (recording the offsets the client requested); everything else gets
 *  a generic empty-200 so the page boots without a backend.
 *
 *  NOTE the host-anchored regex: a naive "api glob" pattern also matches
 *  Vite dev-server module URLs like /src/lib/api/client.gen.ts (the glob
 *  sees the api path segment inside the module URL), which would serve
 *  JSON to a module-script request and crash the whole app boot. */
async function mockApi(page: import('@playwright/test').Page, requestedOffsets: number[]) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/search') {
      const offset = Number(url.searchParams.get('offset') ?? '0') || 0
      const limit = Number(url.searchParams.get('limit') ?? '20') || 20
      requestedOffsets.push(offset)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(servePage(offset, limit)),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    })
  })
}

test.beforeEach(async ({ page }) => {
  // Fail loud on page crashes (the gallery specs' pattern).
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)))
})

test('load-more appends pages until the server clears hasMore', async ({ page }) => {
  const requestedOffsets: number[] = []
  await mockApi(page, requestedOffsets)

  await page.goto(
    `/search?from=${encodeURIComponent('Hà Nội')}&to=${encodeURIComponent('Đà Nẵng')}&date=${DATE}`,
    { waitUntil: 'domcontentloaded' },
  )

  const cards = page.getByTestId('trip-card')
  const loadMore = page.getByTestId('load-more-button')

  // Page 1: exactly PAGE_SIZE cards + the load-more button.
  await expect(cards.first()).toBeVisible({ timeout: 20_000 })
  await expect(cards).toHaveCount(PAGE_SIZE)
  await expect(loadMore).toBeVisible()
  await expect(loadMore).toContainText(`${TOTAL_TRIPS - PAGE_SIZE}`) // "15 more"

  // Click 1: page 2 appends (10 → 20 cards), button still there (5 more).
  await loadMore.click()
  await expect(cards).toHaveCount(PAGE_SIZE * 2, { timeout: 10_000 })
  await expect(loadMore).toBeVisible()
  await expect(loadMore).toContainText(`${TOTAL_TRIPS - PAGE_SIZE * 2}`)

  // Click 2: the final partial page (5 trips) — hasMore clears → the
  // button disappears, the full 25 trips are on screen.
  await loadMore.click()
  await expect(cards).toHaveCount(TOTAL_TRIPS, { timeout: 10_000 })
  await expect(loadMore).toHaveCount(0)

  // The client requested consecutive pages: 0, 10, 20 — offset += limit.
  expect(requestedOffsets).toEqual([0, PAGE_SIZE, PAGE_SIZE * 2])

  // The showing-X-of-Y line reflects the loaded window.
  await expect(page.getByTestId('load-more-tail')).toHaveCount(0)
})

test('single page (hasMore false) renders no load-more button', async ({ page }) => {
  // Override the generic mock with a one-page server: 4 trips, no more.
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/search') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [trip(0), trip(1), trip(2), trip(3)],
          total: 4,
          limit: 10,
          offset: 0,
          hasMore: false,
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    })
  })

  await page.goto(
    `/search?from=${encodeURIComponent('Hà Nội')}&to=${encodeURIComponent('Đà Nẵng')}&date=${DATE}`,
    { waitUntil: 'domcontentloaded' },
  )

  const cards = page.getByTestId('trip-card')
  await expect(cards.first()).toBeVisible({ timeout: 20_000 })
  await expect(cards).toHaveCount(4)
  await expect(page.getByTestId('load-more-button')).toHaveCount(0)
})

test('a re-search resets the accumulated pages', async ({ page }) => {
  const requestedOffsets: number[] = []
  await mockApi(page, requestedOffsets)

  await page.goto(
    `/search?from=${encodeURIComponent('Hà Nội')}&to=${encodeURIComponent('Đà Nẵng')}&date=${DATE}`,
    { waitUntil: 'domcontentloaded' },
  )
  const cards = page.getByTestId('trip-card')
  await expect(cards.first()).toBeVisible({ timeout: 20_000 })
  await expect(cards).toHaveCount(PAGE_SIZE)

  // Load page 2 → 20 cards on screen.
  await page.getByTestId('load-more-button').click()
  await expect(cards).toHaveCount(PAGE_SIZE * 2, { timeout: 10_000 })

  // Change the destination via the compact search bar and re-search:
  // the To field → type a new city → submit. The results must RESET to
  // a single page (10) for the new query, not stay at 20 stale cards.
  const toInput = page.locator('form input').nth(1)
  await toInput.click()
  await toInput.fill('Hải Phòng')
  await page.keyboard.press('Enter') // pick the highlighted city row
  await page.locator('form button[type="submit"]').first().click()

  await expect(async () => {
    // The mock ignores from/to so the page content is identical —
    // assert on the RESET itself: card count back to PAGE_SIZE.
    await expect(cards).toHaveCount(PAGE_SIZE)
  }).toPass({ timeout: 20_000 })

  // And the new query started over at offset 0 (after the two 0/10 of
  // the first search — [0, 10, 0]).
  expect(requestedOffsets[requestedOffsets.length - 1]).toBe(0)
})
