/**
 * TanStack Router — type-safe, URL-driven routing for the DatXeVui SPA.
 *
 * WHY TANSTACK ROUTER (not React Router / not Zustand view-state)
 * ───────────────────────────────────────────────────────────────
 *   1. Real URL paths + browser history — every view has its own URL
 *      (`/search`, `/trips/c0msahvl69zv29elx`, `/brands/phuong-trang`).
 *      Back/forward buttons work, deep links are shareable, crawlers see
 *      distinct pages (SEO).
 *   2. Typed search params — `validateSearch` gives us a typed object for
 *      `/search?from=...&to=...&date=...` instead of hand-parsed strings.
 *   3. Native TanStack Query integration — route loaders can prefetch
 *      queries so the page renders with data on first paint.
 *   4. Code-splitting — each route is a lazy island; only the active
 *      route's chunk downloads.
 *
 * ROUTE TREE
 * ──────────
 *   /                       Home (hero + marketing sections)
 *   /search                 Search results (typed search params)
 *   /trips/$tripId          Trip detail + seat selection (deep-linkable)
 *   /brands/$slug           Brand detail (deep-linkable)
 *   /bookings               My bookings (auth-guarded)
 *   /bookings/$code         Single booking detail (deep-linkable)
 *   /compare                Trip comparison
 *   /map                    Live map view
 *   /admin                  Admin dashboard (employee-guarded)
 *   /login                  Login page
 *
 * Dialogs (chat, booking flow, share, cancel, price-alert, loyalty)
 * remain in Zustand — they are transient overlays, not destinations.
 *
 * Module map (split from the original single router.tsx):
 *   ./lazy-pages     — lazy() page + overlay components, eager shells
 *   ./route-meta     — per-route SEO <title>/<meta> + noindex + GA4
 *   ./guards         — requireAuth / requireStaff / requireAdmin
 *   ./root-route     — root shell (header/footer/overlays) + bootstrap
 *   ./admin-routes   — /admin layout + children
 *   ./account-routes — /account layout + children
 *   ./index (here)   — public routes + tree assembly + router factory
 */

import {
  createRouter,
  createRoute,
  createBrowserHistory,
  type RouterHistory,
} from '@tanstack/react-router'
import { Suspense } from 'react'
import { IslandFallback } from '@/routes/_fallback'
import { rootRoute } from './root-route'
import { adminLayoutRoute, adminIndexRoute, adminBrandsRoute, adminRoutesRoute, adminSchedulesRoute, adminVehicleTypesRoute, adminCronJobsRoute, adminTicketsRoute, adminChatRoute, adminFeedbackRoute, adminBusLayoutsRoute, adminSystemRoute, adminUsersRoute, adminPaymentsRoute } from './admin-routes'
import { accountLayoutRoute, accountIndexRoute, accountWishlistRoute, accountLoyaltyRoute, accountNotificationsRoute, accountSecurityRoute, accountTripsRoute, accountFeedbackRoute } from './account-routes'
import { HomePage, SearchPage, TripDetailPage, BrandDetailPage, BookingsPage, BookingDetailPage, ComparePage, MapPage, LoginPage } from './lazy-pages'

// ── Public routes ──────────────────────────────────────────────

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={600} />}>
      <HomePage />
    </Suspense>
  ),
})

// Typed search params for /search
const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  validateSearch: (search: Record<string, unknown>): {
    from?: string
    to?: string
    date?: string
    adults?: number
    children?: number
    sort?: 'departure' | 'price' | 'duration' | 'rating'
    vehicleTypes?: string[]
    roundTrip?: boolean
    returnDate?: string
  } => {
    // Return ONLY keys that have meaningful values — this keeps the URL
    // clean (no `vehicleTypes=%5B%5D&roundTrip=false&returnDate=` noise).
    // TanStack Router serializes the validated output to the URL, so
    // omitting empty/falsy defaults here keeps them out of the address bar.
    // Components read these via `useSearch({ from: '/search' })` and apply
    // defaults (adults=1, children=0, sort='departure', etc.) at read time.
    const out: Record<string, unknown> = {}
    if (typeof search.from === 'string' && search.from) out.from = search.from
    if (typeof search.to === 'string' && search.to) out.to = search.to
    if (typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date)) out.date = search.date
    if (typeof search.adults === 'string') {
      const n = Math.max(1, parseInt(search.adults, 10) || 1)
      if (n !== 1) out.adults = n
    }
    if (typeof search.children === 'string') {
      const n = Math.max(0, parseInt(search.children, 10) || 0)
      if (n !== 0) out.children = n
    }
    if (typeof search.sort === 'string') {
      const s = search.sort
      if (s === 'price' || s === 'duration' || s === 'rating') out.sort = s
    }
    if (typeof search.vt === 'string') {
      const list = search.vt.split(',').map((s) => s.trim()).filter(Boolean)
      if (list.length) out.vehicleTypes = list
    }
    if (search.roundTrip === '1' || search.roundTrip === 'true') out.roundTrip = true
    if (typeof search.returnDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.returnDate)) out.returnDate = search.returnDate
    return out
  },
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={500} />}>
      <SearchPage />
    </Suspense>
  ),
})

const tripDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips/$tripId',
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={600} />}>
      <TripDetailPage />
    </Suspense>
  ),
})

const brandDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/brands/$slug',
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={500} />}>
      <BrandDetailPage />
    </Suspense>
  ),
})

const bookingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bookings',
  beforeLoad: () => {
    // Soft guard — the page itself handles the guest lookup fallback,
    // but if we have a cached user who is NOT logged in server-side,
    // we still allow access (guests can look up by code+phone).
  },
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={500} />}>
      <BookingsPage />
    </Suspense>
  ),
})

const bookingDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bookings/$code',
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={500} />}>
      <BookingDetailPage />
    </Suspense>
  ),
})

const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compare',
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={400} />}>
      <ComparePage />
    </Suspense>
  ),
})

const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/map',
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={500} />}>
      <MapPage />
    </Suspense>
  ),
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={500} />}>
      <LoginPage />
    </Suspense>
  ),
})

// ── Route tree ──────────────────────────────────────────────────

export const routeTree = rootRoute.addChildren([
  adminLayoutRoute.addChildren([
    adminIndexRoute,
    adminBrandsRoute,
    adminRoutesRoute,
    adminSchedulesRoute,
    adminVehicleTypesRoute,
    adminCronJobsRoute,
    adminTicketsRoute,
    adminChatRoute,
    adminFeedbackRoute,
    adminBusLayoutsRoute,
    adminSystemRoute,
    adminUsersRoute,
    adminPaymentsRoute,
  ]),
  accountLayoutRoute.addChildren([
    accountIndexRoute,
    accountWishlistRoute,
    accountLoyaltyRoute,
    accountNotificationsRoute,
    accountSecurityRoute,
    accountTripsRoute,
    accountFeedbackRoute,
  ]),
  indexRoute,
  searchRoute,
  tripDetailRoute,
  brandDetailRoute,
  bookingsRoute,
  bookingDetailRoute,
  compareRoute,
  mapRoute,
  loginRoute,
])

// ── Router factory + singleton ─────────────────────────────────
// `createAppRouter(history?)` accepts an optional history. On the
// client we pass nothing → defaults to browser history. For SSR /
// prerender, pass `createMemoryHistory({ initialEntries: [url] })`.
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: 'intent', // prefetch route on hover/focus
    defaultPreloadDelay: 50,
    defaultStaleTime: 5 * 60 * 1000,
    scrollRestoration: true,
  })
}

// Client singleton — browser history. We export the router type for
// type-safe `useNavigate` / `Link`.
export const router = createAppRouter(
  typeof window !== 'undefined' ? createBrowserHistory() : undefined,
)

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Re-export navigation helpers for ergonomic usage in components.
// (Same surface the original src/router.tsx exposed — 30+ importers.)
export { useNavigate, useRouterState, Link } from '@tanstack/react-router'
