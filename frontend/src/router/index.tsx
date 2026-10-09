/**
 * The route tree. Every page is a code-split chunk loaded by
 * `lazyRouteComponent`; layouts (customer chrome, admin and account
 * shells) are eager so they never remount between pages. `staticData`
 * carries what the document head needs (see `app/route-meta.tsx`).
 */
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent as lazy,
  redirect,
  stripSearchParams,
  type RouterHistory,
  type SearchSchemaInput,
} from '@tanstack/react-router'
import { AccountLayout } from '@/app/layout/account-layout'
import { AdminLayout } from '@/app/layout/admin-layout'
import { NotFoundPage } from '@/app/not-found'
import { RootLayout } from '@/app/root-layout'
import { parseSearch, SEARCH_DEFAULTS, type SearchInput } from '@/lib/search-params'
import { requireAdmin, requireAuth, requireStaff } from './guards'

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundPage })

// ── Customer pages ────────────────────────────────────────────

const home = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazy(() => import('@/features/home/home-page'), 'HomePage'),
  staticData: { seo: 'home' },
})

const search = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  // Typed input for links; output has every default applied, and the URL
  // only carries what differs from them.
  validateSearch: (raw: SearchInput & SearchSchemaInput) =>
    parseSearch(raw as Record<string, unknown>),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },
  component: lazy(() => import('@/features/search/search-page'), 'SearchPage'),
  staticData: { seo: 'search' },
})

const trip = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips/$tripId',
  component: lazy(() => import('@/features/trips/trip-page'), 'TripPage'),
  staticData: { seo: 'tripDetail' },
})

const brand = createRoute({
  getParentRoute: () => rootRoute,
  path: '/brands/$slug',
  component: lazy(() => import('@/features/brand/brand-page'), 'BrandPage'),
  staticData: { seo: 'brandDetail' },
})

const booking = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bookings/$code',
  component: lazy(() => import('@/features/booking/booking-detail-page'), 'BookingDetailPage'),
  staticData: { seo: 'bookingDetail' },
})

const compare = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compare',
  component: lazy(() => import('@/features/search/compare-page'), 'ComparePage'),
  staticData: { seo: 'compare' },
})

const login = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: lazy(() => import('@/features/auth/login-page'), 'LoginPage'),
  staticData: { seo: 'login', private: true },
})

// ── Admin (staff only) ────────────────────────────────────────

const admin = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: requireStaff,
  component: AdminLayout,
  staticData: { private: true },
})

const adminPages = {
  index: createRoute({
    getParentRoute: () => admin,
    path: '/',
    component: lazy(() => import('@/features/admin/dashboard'), 'AdminDashboard'),
    staticData: { seo: 'admin' },
  }),
  brands: createRoute({
    getParentRoute: () => admin,
    path: '/brands',
    component: lazy(() => import('@/features/admin/brands'), 'AdminBrandManagement'),
    staticData: { seo: 'adminBrands' },
  }),
  vehicleTypes: createRoute({
    getParentRoute: () => admin,
    path: '/vehicle-types',
    component: lazy(() => import('@/features/admin/vehicle-types/vehicle-types-panel'), 'VehicleTypesPanel'),
    staticData: { seo: 'adminVehicleTypes' },
  }),
  busLayouts: createRoute({
    getParentRoute: () => admin,
    path: '/bus-layouts',
    component: lazy(() => import('@/features/admin/bus-layouts/bus-layouts-page'), 'AdminBusLayoutsPage'),
    staticData: { seo: 'adminBusLayouts' },
  }),
  tickets: createRoute({
    getParentRoute: () => admin,
    path: '/tickets',
    component: lazy(() => import('@/features/admin/tickets/tickets-panel'), 'TicketsPanel'),
    staticData: { seo: 'adminTickets' },
  }),
  chat: createRoute({
    getParentRoute: () => admin,
    path: '/chat',
    component: lazy(() => import('@/features/admin/chat/chat-page'), 'AdminChatPage'),
    staticData: { seo: 'adminChat' },
  }),
  feedback: createRoute({
    getParentRoute: () => admin,
    path: '/feedback',
    component: lazy(() => import('@/features/admin/feedback/feedback-panel'), 'FeedbackPanel'),
    staticData: { seo: 'adminFeedback' },
  }),
  payments: createRoute({
    getParentRoute: () => admin,
    path: '/payments',
    component: lazy(() => import('@/features/admin/payments/payments-panel'), 'AdminPaymentsPanel'),
    staticData: { seo: 'adminPayments' },
  }),
  cronJobs: createRoute({
    getParentRoute: () => admin,
    path: '/cron-jobs',
    component: lazy(() => import('@/features/admin/cron-jobs/cron-jobs-panel'), 'CronJobsPanel'),
    staticData: { seo: 'adminCronJobs' },
  }),
  system: createRoute({
    getParentRoute: () => admin,
    path: '/system',
    component: lazy(() => import('@/features/admin/system/system-page'), 'AdminSystemPage'),
    staticData: { seo: 'adminSystem' },
  }),
  users: createRoute({
    getParentRoute: () => admin,
    path: '/users',
    beforeLoad: requireAdmin,
    component: lazy(() => import('@/features/admin/users/users-panel'), 'UsersPanel'),
    staticData: { seo: 'adminUsers' },
  }),
}

// Routes and schedules now live in the brands tree; old bookmarks still work.
const toBrands = () => {
  throw redirect({ to: '/admin/brands', replace: true })
}
const oldRoutes = createRoute({ getParentRoute: () => admin, path: '/routes', beforeLoad: toBrands })
const oldSchedules = createRoute({
  getParentRoute: () => admin,
  path: '/schedules',
  beforeLoad: toBrands,
})

// ── Account (signed-in customers) ─────────────────────────────

const account = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  beforeLoad: requireAuth,
  component: AccountLayout,
  staticData: { private: true },
})

const accountPages = {
  index: createRoute({
    getParentRoute: () => account,
    path: '/',
    component: lazy(() => import('@/features/account/console/user-console'), 'UserConsole'),
    staticData: { seo: 'account' },
  }),
  trips: createRoute({
    getParentRoute: () => account,
    path: '/trips',
    component: lazy(() => import('@/features/booking/history/my-bookings'), 'MyBookings'),
    staticData: { seo: 'accountTrips' },
  }),
  loyalty: createRoute({
    getParentRoute: () => account,
    path: '/loyalty',
    component: lazy(() => import('@/features/loyalty/loyalty-page'), 'AccountLoyaltyPage'),
    staticData: { seo: 'accountLoyalty' },
  }),
  notifications: createRoute({
    getParentRoute: () => account,
    path: '/notifications',
    component: lazy(() => import('@/features/notifications/notifications-page'), 'AccountNotificationsPage'),
    staticData: { seo: 'accountNotifications' },
  }),
  security: createRoute({
    getParentRoute: () => account,
    path: '/security',
    component: lazy(() => import('@/features/account/security-page'), 'AccountSecurityPage'),
    staticData: { seo: 'accountSecurity' },
  }),
  feedback: createRoute({
    getParentRoute: () => account,
    path: '/feedback',
    component: lazy(() => import('@/features/account/feedback/feedback-content'), 'AccountFeedbackContent'),
    staticData: { seo: 'accountFeedback' },
  }),
}

export const routeTree = rootRoute.addChildren({
  home,
  search,
  trip,
  brand,
  booking,
  compare,
  login,
  admin: admin.addChildren({ ...adminPages, oldRoutes, oldSchedules }),
  account: account.addChildren(accountPages),
})

/** Browser history on the client; prerender passes a memory history. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: 'intent',
    defaultPreloadDelay: 50,
    defaultStaleTime: 5 * 60 * 1000,
    scrollRestoration: true,
  })
}

export const router = createAppRouter(
  typeof window !== 'undefined' ? createBrowserHistory() : undefined,
)

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
