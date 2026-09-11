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
import { trackPageView } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { Header } from '@/components/layout/header'
import { IslandFallback } from '@/routes/_fallback'
// Persistent shells — imported EAGERLY (not lazy) so the sidebar /
// account nav never unmounts during page-to-page navigation. Only the
// content area inside the shell swaps (with a skeleton fallback), which
// eliminates the old full-page white-flash spinner.
import { AdminShell } from '@/components/layout/admin-shell'
import { AccountShell } from '@/components/layout/account-shell'
import { AdminContentSkeleton, AccountContentSkeleton } from '@/components/layout/skeletons'

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
const AdminBrandsPage = lazy(() => import('./routes/admin/brands').then((m) => ({ default: m.AdminBrandsPage })))
const AdminRoutesPage = lazy(() => import('./routes/admin/routes').then((m) => ({ default: m.AdminRoutesPage })))
const AdminSchedulesPage = lazy(() => import('./routes/admin/schedules').then((m) => ({ default: m.AdminSchedulesPage })))
const AdminCronJobsPage = lazy(() => import('./routes/admin/cron-jobs').then((m) => ({ default: m.AdminCronJobsPage })))
const AdminTicketsPage = lazy(() => import('./routes/admin/tickets').then((m) => ({ default: m.AdminTicketsPage })))
const AdminChatPage = lazy(() => import('./routes/admin/chat').then((m) => ({ default: m.AdminChatPage })))
const AdminFeedbackPage = lazy(() => import('./routes/admin/feedback').then((m) => ({ default: m.AdminFeedbackPage })))
const AdminBusLayoutsPage = lazy(() => import('./routes/admin/bus-layouts').then((m) => ({ default: m.AdminBusLayoutsPage })))
const AdminVehicleTypesPage = lazy(() => import('./routes/admin/vehicle-types').then((m) => ({ default: m.AdminVehicleTypesPage })))
const AdminSystemPage = lazy(() => import('./routes/admin/system').then((m) => ({ default: m.AdminSystemPage })))
const AdminUsersPage = lazy(() => import('./routes/admin/users').then((m) => ({ default: m.AdminUsersPage })))
const AdminPaymentsPage = lazy(() => import('./routes/admin/payments').then((m) => ({ default: m.AdminPaymentsPage })))
// Account pages
const AccountPage = lazy(() => import('./routes/account').then((m) => ({ default: m.AccountPage })))
const AccountWishlistPage = lazy(() => import('./routes/account/wishlist').then((m) => ({ default: m.AccountWishlistPage })))
const AccountLoyaltyPage = lazy(() => import('./routes/account/loyalty').then((m) => ({ default: m.AccountLoyaltyPage })))
const AccountNotificationsPage = lazy(() => import('./routes/account/notifications').then((m) => ({ default: m.AccountNotificationsPage })))
const AccountSecurityPage = lazy(() => import('./routes/account/security').then((m) => ({ default: m.AccountSecurityPage })))
const AccountTripsPage = lazy(() => import('./routes/account/trips').then((m) => ({ default: m.AccountTripsPage })))
const AccountFeedbackPage = lazy(() => import('./routes/account/feedback').then((m) => ({ default: m.AccountFeedbackPage })))
const LoginPage = lazy(() => import('./routes/login').then((m) => ({ default: m.LoginPageRoute })))
const NotFoundPage = lazy(() => import('./routes/not-found').then((m) => ({ default: m.NotFoundPage })))

// Lazy persistent overlays (kept mounted once loaded for instant re-open)
const Footer = lazy(() => import('@/components/layout/footer').then((m) => ({ default: m.Footer })))
const MobileNav = lazy(() => import('@/components/layout/mobile-nav').then((m) => ({ default: m.MobileNav })))
const ChatWidget = lazy(() => import('@/features/chat/chat-widget').then((m) => ({ default: m.ChatWidget })))
const AudioCallWidget = lazy(() => import('@/components/layout/audio-call-widget').then((m) => ({ default: m.AudioCallWidget })))
const BookingDialog = lazy(() => import('@/features/booking/flow/booking-dialog').then((m) => ({ default: m.BookingDialog })))
const TripCompare = lazy(() => import('@/features/search/trip-compare').then((m) => ({ default: m.TripCompare })))
const LoyaltyWidget = lazy(() => import('@/features/home/loyalty-widget').then((m) => ({ default: m.LoyaltyWidget })))
const CancelDialog = lazy(() => import('@/features/booking/history/cancel-dialog').then((m) => ({ default: m.CancelDialog })))
const PriceAlertDialog = lazy(() => import('@/features/price-alert/price-alert-dialog').then((m) => ({ default: m.PriceAlertDialog })))
const ShareDialog = lazy(() => import('@/features/trips/share-dialog').then((m) => ({ default: m.ShareDialog })))
const SupportFab = lazy(() => import('@/components/layout/support-fab').then((m) => ({ default: m.SupportFab })))

// ── Document head management (SEO) ─────────────────────────────
// Updates <title> + <meta name="description"> per route. For the
// prerendered home page, the meta tags are baked into index.html at
// build time; for client-side navigations we update them here.
const ROUTE_META: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'DatXeVui — Đặt vé xe khách online | Xe giường nằm, limousine giá rẻ',
    description: 'Đặt vé xe khách online nhanh chóng, giá tốt nhất. Xe giường nằm, limousine, sleeper bus các tuyến Hà Nội, Đà Nẵng, Sài Gòn. Hỗ trợ 24/7.',
  },
  '/search': {
    title: 'Tìm chuyến xe — DatXeVui',
    description: 'So sánh giá vé xe khách các hãng. Lọc theo giờ đi, giá, loại xe, đánh giá.',
  },
  '/bookings': {
    title: 'Vé của tôi — DatXeVui',
    description: 'Quản lý vé đã đặt, lịch sử chuyến đi, đánh giá chuyến.',
  },
  '/admin': {
    title: 'Quản trị — DatXeVui',
    description: 'Bảng điều khiển quản trị hệ thống DatXeVui.',
  },
  '/admin/brands': { title: 'Hãng xe — Quản trị DatXeVui', description: 'Quản lý hãng xe, tuyến đường, lịch trình.' },
  '/admin/routes': { title: 'Tuyến đường — Quản trị DatXeVui', description: 'Quản lý tuyến đường.' },
  '/admin/schedules': { title: 'Lịch trình — Quản trị DatXeVui', description: 'Quản lý lịch trình.' },
  '/admin/cron-jobs': { title: 'Cron jobs — Quản trị DatXeVui', description: 'Quản lý tác vụ nền định kỳ.' },
  '/admin/tickets': { title: 'Vé đã bán — Quản trị DatXeVui', description: 'Quản lý vé đã bán.' },
  '/admin/chat': { title: 'Chat hỗ trợ — Quản trị DatXeVui', description: 'Hỗ trợ khách hàng qua chat.' },
  '/admin/feedback': { title: 'Phản hồi — Quản trị DatXeVui', description: 'Quản lý phản hồi khách hàng.' },
  '/admin/bus-layouts': { title: 'Sơ đồ ghế — Quản trị DatXeVui', description: 'Quản lý sơ đồ ghế xe.' },
  '/admin/vehicle-types': { title: 'Loại xe — Quản trị DatXeVui', description: 'Quản lý danh mục loại xe.' },
  '/admin/system': { title: 'Hệ thống — Quản trị DatXeVui', description: 'Theo dõi hệ thống.' },
  '/admin/users': { title: 'Người dùng — Quản trị DatXeVui', description: 'Quản lý vai trò người dùng, nhân viên và quản trị viên.' },
  '/admin/payments': { title: 'Thanh toán — Quản trị DatXeVui', description: 'Quản lý giao dịch thanh toán.' },
  '/account': { title: 'Tài khoản — DatXeVui', description: 'Quản lý tài khoản và cài đặt.' },
  '/account/wishlist': { title: 'Yêu thích — DatXeVui', description: 'Danh sách yêu thích.' },
  '/account/loyalty': { title: 'Điểm thưởng — DatXeVui', description: 'Điểm tích lũy.' },
  '/account/notifications': { title: 'Thông báo — DatXeVui', description: 'Cài đặt thông báo.' },
  '/account/security': { title: 'Bảo mật — DatXeVui', description: 'Bảo mật tài khoản.' },
  '/account/trips': { title: 'Lịch sử chuyến đi — DatXeVui', description: 'Lịch sử đặt vé và đánh giá chuyến đi.' },
  '/account/feedback': { title: 'Phản hồi của tôi — DatXeVui', description: 'Lịch sử đánh giá các chuyến đi đã đi.' },
  '/map': {
    title: 'Bản đồ tuyến đường — DatXeVui',
    description: 'Xem bản đồ các tuyến xe khách phổ biến trên khắp Việt Nam.',
  },
  '/login': {
    title: 'Đăng nhập — DatXeVui',
    description: 'Đăng nhập để đặt vé, xem vé của bạn và tích điểm thưởng.',
  },
  '/compare': {
    title: 'So sánh chuyến xe — DatXeVui',
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
        meta = { title: 'Chi tiết chuyến xe — DatXeVui', description: 'Xem sơ đồ ghế, lịch trình, đánh giá và đặt vé trực tuyến.' }
      } else if (pathname.startsWith('/brands/')) {
        meta = { title: 'Hãng xe — DatXeVui', description: 'Thông tin hãng xe, tuyến đường, đánh giá khách hàng.' }
      } else if (pathname.startsWith('/bookings/')) {
        meta = { title: 'Chi tiết vé — DatXeVui', description: 'Thông tin vé đã đặt.' }
      } else {
        meta = { title: 'DatXeVui — Đặt vé xe khách online', description: ROUTE_META['/'].description }
      }
    }
    if (typeof document !== 'undefined') {
      document.title = meta.title
      const descTag = document.querySelector('meta[name="description"]')
      if (descTag) descTag.setAttribute('content', meta.description)

      // ── noindex for private routes (UIUX-017) ───────────────────
      // Admin + account pages should never be indexed by search engines.
      // We add/update `<meta name="robots" content="noindex, nofollow">`
      // on these routes, and remove it on public routes (so the meta
      // element doesn't accumulate stale state across SPA navigations).
      const isPrivate = pathname.startsWith('/admin') || pathname.startsWith('/account') || pathname === '/login'
      let robotsTag = document.querySelector('meta[name="robots"]')
      if (isPrivate) {
        if (!robotsTag) {
          robotsTag = document.createElement('meta')
          robotsTag.setAttribute('name', 'robots')
          document.head.appendChild(robotsTag)
        }
        robotsTag.setAttribute('content', 'noindex, nofollow')
      } else if (robotsTag) {
        // Remove the noindex tag on public routes so they're crawlable.
        robotsTag.remove()
      }

      // ── GA4 page-view tracking ──────────────────────────────
      // Fires on every SPA route change. No-op if GA4 isn't configured.
      // Skip on private routes — admin/account activity shouldn't hit
      // analytics (PII + abuse-vector protection).
      if (!isPrivate) {
        trackPageView(pathname, meta.title)
      }
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
//
// CRITICAL: hydrateFromStorage() is called SYNCHRONOUSLY at module
// load time (below, before the router is created) so that the
// `beforeLoad` guard in admin routes can read the user from the store
// on a page reload. Without this, the store is empty on reload →
// `user.type` is neither 'employee' nor 'admin' → redirect to /login.
if (typeof window !== 'undefined') {
  hydrateFromStorage()
}

function AuthBootstrap() {
  const { user, setUser, bookingStep } = useApp()
  const { data, isLoading, isError } = useAuthMe()

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
    bookingStep,
  } = useApp()

  const hideFooter = pathname === '/login'

  const isAdminRoute = pathname.startsWith('/admin')
  const isAccountRoute = pathname.startsWith('/account')
  const isAppShellRoute = isAdminRoute || isAccountRoute

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <RouteMeta />
      <ScrollRestoration />
      <AuthBootstrap />

      {!isAccountRoute && <Header />}

      <main
        className={cn(
          'flex-1',
          // Bottom padding clears the customer MobileNav bar — only
          // needed on routes that actually render it.
          !isAppShellRoute && 'pb-16 md:pb-0',
        )}
      >
        <Outlet />
      </main>

      {!hideFooter && !isAppShellRoute && (
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
        {/* Keep call signaling mounted so staff can receive inbound calls;
            customers open the call panel from the support-chat header. */}
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
      {/* MobileNav + SupportFab are hidden on admin/account pages — those
          routes have their own sidebar drawer + top bar. */}
      {!pathname.startsWith('/admin') && !pathname.startsWith('/account') && (
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
      )}
      {!pathname.startsWith('/admin') && !pathname.startsWith('/account') && (
        <Suspense fallback={null}>
          <SupportFab />
        </Suspense>
      )}
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

// ── Route guards ────────────────────────────────────────────────
//
// Two guard helpers:
//
//   requireAuth()      — must be logged in (any user type). If not,
//                         redirect to /login.
//   requireStaff()      — must be logged in as staff (employee or
//                         admin). Otherwise redirect to /login.
//
// CRITICAL: the previous guards checked `if (user && user.type !== 'employee')`
// which is FALSE when `user` is null (unauthenticated). This allowed
// unauthenticated visitors to access admin pages — the bug we're fixing.
// The new checks use `!user || !isStaff(user)` which correctly
// blocks both cases: no user at all, or a non-employee user.

function requireAuth() {
  const { user } = useApp.getState()
  if (!user) {
    throw redirect({ to: '/login' })
  }
}

function requireStaff() {
  const { user } = useApp.getState()
  // Three-role model: employees AND admins are staff; customers are not.
  if (!user || (user.type !== 'employee' && user.type !== 'admin')) {
    throw redirect({ to: '/login' })
  }
}

/** Admin-only guard — the Users page + other governance screens. */
function requireAdmin() {
  const { user } = useApp.getState()
  if (!user || user.type !== 'admin') {
    // Staff without admin rights land on the dashboard instead.
    if (user && user.type === 'employee') throw redirect({ to: '/admin' })
    throw redirect({ to: '/login' })
  }
}

// ── Admin layout route (PERSISTENT SHELL) ─────────────────────────
//
// All /admin/* pages render INSIDE this layout: the AdminShell (sidebar
// + top bar) mounts ONCE and stays mounted across admin navigations —
// only the content area swaps. The Suspense fallback is a
// structure-matched skeleton (toolbar + table + pagination), so lazy
// chunk loads never flash a blank white page. The staff guard lives on
// the layout, so every child inherits it.
const adminLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: requireStaff,
  component: AdminLayoutComponent,
})

function AdminLayoutComponent() {
  return (
    <AdminShell>
      <Suspense fallback={<AdminContentSkeleton />}>
        <Outlet />
      </Suspense>
    </AdminShell>
  )
}

// Admin child routes — panels only (the shell comes from the layout).
// Guards are inherited from the layout; `users` adds the admin-only
// guard on top.
const adminIndexRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminPage />
    </Suspense>
  ),
})

const adminBrandsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/brands',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminBrandsPage />
    </Suspense>
  ),
})

const adminRoutesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/routes',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminRoutesPage />
    </Suspense>
  ),
})

const adminSchedulesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/schedules',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminSchedulesPage />
    </Suspense>
  ),
})

// Admin route — vehicle type catalog (schedule form's "Loại xe" picker).
const adminVehicleTypesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/vehicle-types',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminVehicleTypesPage />
    </Suspense>
  ),
})

// Admin route — cron jobs (recurring background jobs, e.g. the OSM import).
const adminCronJobsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/cron-jobs',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminCronJobsPage />
    </Suspense>
  ),
})

const adminTicketsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/tickets',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminTicketsPage />
    </Suspense>
  ),
})

const adminChatRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/chat',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminChatPage />
    </Suspense>
  ),
})


const adminFeedbackRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/feedback',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminFeedbackPage />
    </Suspense>
  ),
})

const adminBusLayoutsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/bus-layouts',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminBusLayoutsPage />
    </Suspense>
  ),
})

const adminSystemRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/system',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminSystemPage />
    </Suspense>
  ),
})

// Users admin page — ADMIN only (employees redirect to the dashboard).
const adminUsersRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/users',
  beforeLoad: requireAdmin,
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminUsersPage />
    </Suspense>
  ),
})

const adminPaymentsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/payments',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminPaymentsPage />
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

// ── Account layout route (PERSISTENT SHELL) ──────────────────────
//
// Same pattern as the admin layout: the AccountShell (side nav +
// gradient header) stays mounted; only the content area swaps with a
// structure-matched skeleton fallback. The auth guard lives on the
// layout so every child inherits it.
const accountLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  beforeLoad: requireAuth,
  component: AccountLayoutComponent,
})

function AccountLayoutComponent() {
  return (
    <AccountShell>
      <Suspense fallback={<AccountContentSkeleton />}>
        <Outlet />
      </Suspense>
    </AccountShell>
  )
}

// Account child routes — content only (shell from the layout).
const accountIndexRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountPage />
    </Suspense>
  ),
})

const accountWishlistRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/wishlist',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountWishlistPage />
    </Suspense>
  ),
})

const accountLoyaltyRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/loyalty',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountLoyaltyPage />
    </Suspense>
  ),
})

const accountNotificationsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/notifications',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountNotificationsPage />
    </Suspense>
  ),
})

const accountSecurityRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/security',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountSecurityPage />
    </Suspense>
  ),
})

const accountTripsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/trips',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountTripsPage />
    </Suspense>
  ),
})

// Feedback history — the user's submitted trip reviews (star ratings).
const accountFeedbackRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/feedback',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountFeedbackPage />
    </Suspense>
  ),
})

const routeTree = rootRoute.addChildren([
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
export { useNavigate, useRouterState, Link }
