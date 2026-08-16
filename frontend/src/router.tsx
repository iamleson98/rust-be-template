/**
 * TanStack Router — type-safe, URL-driven routing for the VeXeVN SPA.
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
 * Dialogs (chat, booking flow, auth, share, cancel, price-alert, loyalty)
 * remain in Zustand — they are transient overlays, not destinations.
 */

import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
  useRouterState,
  useNavigate,
  Link,
  createBrowserHistory,
  type RouterHistory,
} from '@tanstack/react-router'
import { lazy, Suspense, useEffect } from 'react'
import { useApp, hydrateFromStorage } from '@/lib/store'
import { useAuthMe } from '@/lib/queries'
import { Header } from '@/components/bus/header'

// ── Lazy route components (code-split per route) ────────────────
const HomePage = lazy(() => import('./routes/home').then((m) => ({ default: m.HomePage })))
const SearchPage = lazy(() => import('./routes/search').then((m) => ({ default: m.SearchPage })))
const TripDetailPage = lazy(() => import('./routes/trip-detail').then((m) => ({ default: m.TripDetailPage })))
const BrandDetailPage = lazy(() => import('./routes/brand-detail').then((m) => ({ default: m.BrandDetailPage })))
const BookingsPage = lazy(() => import('./routes/bookings').then((m) => ({ default: m.BookingsPage })))
const BookingDetailPage = lazy(() => import('./routes/booking-detail').then((m) => ({ default: m.BookingDetailPage })))
const ComparePage = lazy(() => import('./routes/compare').then((m) => ({ default: m.ComparePage })))
const MapPage = lazy(() => import('./routes/map').then((m) => ({ default: m.MapPage })))
const AdminPage = lazy(() => import('./routes/admin').then((m) => ({ default: m.AdminPage })))
const LoginPage = lazy(() => import('./routes/login').then((m) => ({ default: m.LoginPageRoute })))
const NotFoundPage = lazy(() => import('./routes/not-found').then((m) => ({ default: m.NotFoundPage })))

// Lazy persistent overlays (kept mounted once loaded for instant re-open)
const Footer = lazy(() => import('@/components/bus/footer').then((m) => ({ default: m.Footer })))
const MobileNav = lazy(() => import('@/components/bus/mobile-nav').then((m) => ({ default: m.MobileNav })))
const ChatWidget = lazy(() => import('@/components/bus/chat-widget').then((m) => ({ default: m.ChatWidget })))
const AudioCallWidget = lazy(() => import('@/components/bus/audio-call-widget').then((m) => ({ default: m.AudioCallWidget })))
const BookingDialog = lazy(() => import('@/components/bus/booking-dialog').then((m) => ({ default: m.BookingDialog })))
const AuthDialog = lazy(() => import('@/components/bus/auth-dialog').then((m) => ({ default: m.AuthDialog })))
const TripCompare = lazy(() => import('@/components/bus/trip-compare').then((m) => ({ default: m.TripCompare })))
const LoyaltyWidget = lazy(() => import('@/components/bus/loyalty-widget').then((m) => ({ default: m.LoyaltyWidget })))
const CancelDialog = lazy(() => import('@/components/bus/cancel-dialog').then((m) => ({ default: m.CancelDialog })))
const PriceAlertDialog = lazy(() => import('@/components/bus/price-alert-dialog').then((m) => ({ default: m.PriceAlertDialog })))
const ShareDialog = lazy(() => import('@/components/bus/share-dialog').then((m) => ({ default: m.ShareDialog })))
const SupportFab = lazy(() => import('@/components/bus/support-fab').then((m) => ({ default: m.SupportFab })))

function IslandFallback({ minHeight = 200 }: { minHeight?: number }) {
  return <div style={{ minHeight }} aria-busy="true" />
}

// ── Document head management (SEO) ─────────────────────────────
// Updates <title> + <meta name="description"> per route. For the
// prerendered home page, the meta tags are baked into index.html at
// build time; for client-side navigations we update them here.
const ROUTE_META: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'VeXeVN — Đặt vé xe khách online | Xe giường nằm, limousine giá rẻ',
    description: 'Đặt vé xe khách online nhanh chóng, giá tốt nhất. Xe giường nằm, limousine, sleeper bus các tuyến Hà Nội, Đà Nẵng, Sài Gòn. Hỗ trợ 24/7.',
  },
  '/search': {
    title: 'Tìm chuyến xe — VeXeVN',
    description: 'So sánh giá vé xe khách các hãng. Lọc theo giờ đi, giá, loại xe, đánh giá.',
  },
  '/bookings': {
    title: 'Vé của tôi — VeXeVN',
    description: 'Quản lý vé đã đặt, lịch sử chuyến đi, đánh giá chuyến.',
  },
  '/admin': {
    title: 'Quản trị — VeXeVN',
    description: 'Bảng điều khiển quản trị hệ thống VeXeVN.',
  },
  '/map': {
    title: 'Bản đồ tuyến đường — VeXeVN',
    description: 'Xem bản đồ các tuyến xe khách phổ biến trên khắp Việt Nam.',
  },
  '/login': {
    title: 'Đăng nhập — VeXeVN',
    description: 'Đăng nhập để đặt vé, xem vé của bạn và tích điểm thưởng.',
  },
  '/compare': {
    title: 'So sánh chuyến xe — VeXeVN',
    description: 'So sánh giá, giờ đi, tiện nghi của các chuyến xe.',
  },
}

function RouteMeta() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => {
    // Match either exact path or prefix for parameterized routes
    let meta = ROUTE_META[pathname]
    if (!meta) {
      if (pathname.startsWith('/trips/')) {
        meta = { title: 'Chi tiết chuyến xe — VeXeVN', description: 'Xem sơ đồ ghế, lịch trình, đánh giá và đặt vé trực tuyến.' }
      } else if (pathname.startsWith('/brands/')) {
        meta = { title: 'Hãng xe — VeXeVN', description: 'Thông tin hãng xe, tuyến đường, đánh giá khách hàng.' }
      } else if (pathname.startsWith('/bookings/')) {
        meta = { title: 'Chi tiết vé — VeXeVN', description: 'Thông tin vé đã đặt.' }
      } else {
        meta = { title: 'VeXeVN — Đặt vé xe khách online', description: ROUTE_META['/'].description }
      }
    }
    if (typeof document !== 'undefined') {
      document.title = meta.title
      const descTag = document.querySelector('meta[name="description"]')
      if (descTag) descTag.setAttribute('content', meta.description)
    }
  }, [pathname])
  return null
}

// ── Scroll restoration on navigation ───────────────────────────
function ScrollRestoration() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Don't reset scroll when only search params change (e.g. filter updates)
      window.scrollTo(0, 0)
    }
  }, [pathname])
  return null
}

// ── Auth bootstrap ─────────────────────────────────────────────
// Hydrate persisted user from localStorage (fast first paint), then
// verify with the server via useAuthMe (TanStack Query).
function AuthBootstrap() {
  const { user, setUser, bookingStep } = useApp()
  const { data, isLoading, isError } = useAuthMe()

  useEffect(() => {
    hydrateFromStorage()
  }, [])

  useEffect(() => {
    if (isLoading) return
    if (isError || !data) {
      // Server says not authenticated — clear stale cache
      if (user) setUser(null)
      return
    }
    setUser(data.user as Parameters<typeof setUser>[0])
    try {
      localStorage.setItem('bus_user', JSON.stringify(data.user))
    } catch {}
  }, [data, isLoading, isError]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when a booking dialog is open
  useEffect(() => {
    const open = bookingStep !== 'idle'
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [bookingStep])

  return null
}

// ── Root route: shell + persistent overlays ─────────────────────
function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const {
    chatOpen,
    compareList,
    compareOpen,
    loyaltyOpen,
    cancelDialogOpen,
    priceAlertOpen,
    shareOpen,
    authOpen,
    bookingStep,
  } = useApp()

  const hideFooter = pathname === '/login'

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <RouteMeta />
      <ScrollRestoration />
      <AuthBootstrap />

      <Header />

      <main className="flex-1 pb-16 md:pb-0">
        <Outlet />
      </main>

      {!hideFooter && (
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      )}

      {/* Persistent overlays — lazy-loaded, stay mounted after first open */}
      {bookingStep !== 'idle' && (
        <Suspense fallback={null}>
          <BookingDialog />
        </Suspense>
      )}
      {chatOpen && (
        <Suspense fallback={null}>
          <ChatWidget />
        </Suspense>
      )}
      {/* Audio-call FAB — lazy-loaded, but always mounted when authed so the
          agent can receive inbound calls. The component returns null if no
          user is logged in, so it's invisible for anonymous visitors. */}
      <Suspense fallback={null}>
        <AudioCallWidget />
      </Suspense>
      {compareList.length > 0 && compareOpen && (
        <Suspense fallback={null}>
          <TripCompare />
        </Suspense>
      )}
      {loyaltyOpen && (
        <Suspense fallback={null}>
          <LoyaltyWidget />
        </Suspense>
      )}
      {cancelDialogOpen && (
        <Suspense fallback={null}>
          <CancelDialog />
        </Suspense>
      )}
      {priceAlertOpen && (
        <Suspense fallback={null}>
          <PriceAlertDialog />
        </Suspense>
      )}
      {shareOpen && (
        <Suspense fallback={null}>
          <ShareDialog />
        </Suspense>
      )}
      {authOpen && (
        <Suspense fallback={null}>
          <AuthDialog />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
      <Suspense fallback={null}>
        <SupportFab />
      </Suspense>
    </div>
  )
}

// ── Route definitions ──────────────────────────────────────────

const rootRoute = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => (
    <Suspense fallback={<IslandFallback minHeight={400} />}>
      <NotFoundPage />
    </Suspense>
  ),
})

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

// Admin route — employee guard. We check the cached user; if not an
// employee, redirect to /login. The server-side check happens on the
// API call (returns 403), so this is just UX hardening.
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: () => {
    const { user } = useApp.getState()
    if (!user || user.type !== 'employee') {
      throw redirect({ to: '/login' })
    }
  },
  component: () => (
    <Suspense fallback={<IslandFallback minHeight={500} />}>
      <AdminPage />
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  searchRoute,
  tripDetailRoute,
  brandDetailRoute,
  bookingsRoute,
  bookingDetailRoute,
  compareRoute,
  mapRoute,
  adminRoute,
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
export { useNavigate, useRouterState, Link }
