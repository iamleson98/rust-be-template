/**
 * Document head management (SEO) — per-route <title> + meta description.
 *
 * Extracted from the original 'src/router.tsx'.
 *
 * For the prerendered home page, the meta tags are baked into index.html
 * at build time; for client-side navigations we update them here.
 */

import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { trackPageView } from '@/lib/analytics'
import { useApp } from '@/lib/store'
import { translate } from '@/lib/i18n'

// Route → SEO i18n KEYS (not literal text). `RouteMeta` resolves them via
// `t()` at render time, so titles/descriptions re-translate when the user
// switches language. Keys live in `fragments/routes-router.json` (`seo.*`).
export const ROUTE_META: Record<string, { title: string; description: string }> = {
  '/': { title: 'seo.home.title', description: 'seo.home.description' },
  '/search': { title: 'seo.search.title', description: 'seo.search.description' },
  '/bookings': { title: 'seo.bookings.title', description: 'seo.bookings.description' },
  '/admin': { title: 'seo.admin.title', description: 'seo.admin.description' },
  '/admin/brands': { title: 'seo.adminBrands.title', description: 'seo.adminBrands.description' },
  '/admin/cron-jobs': { title: 'seo.adminCronJobs.title', description: 'seo.adminCronJobs.description' },
  '/admin/tickets': { title: 'seo.adminTickets.title', description: 'seo.adminTickets.description' },
  '/admin/chat': { title: 'seo.adminChat.title', description: 'seo.adminChat.description' },
  '/admin/feedback': { title: 'seo.adminFeedback.title', description: 'seo.adminFeedback.description' },
  '/admin/bus-layouts': { title: 'seo.adminBusLayouts.title', description: 'seo.adminBusLayouts.description' },
  '/admin/vehicle-types': { title: 'seo.adminVehicleTypes.title', description: 'seo.adminVehicleTypes.description' },
  '/admin/system': { title: 'seo.adminSystem.title', description: 'seo.adminSystem.description' },
  '/admin/users': { title: 'seo.adminUsers.title', description: 'seo.adminUsers.description' },
  '/admin/payments': { title: 'seo.adminPayments.title', description: 'seo.adminPayments.description' },
  '/account': { title: 'seo.account.title', description: 'seo.account.description' },
  '/account/wishlist': { title: 'seo.accountWishlist.title', description: 'seo.accountWishlist.description' },
  '/account/loyalty': { title: 'seo.accountLoyalty.title', description: 'seo.accountLoyalty.description' },
  '/account/notifications': { title: 'seo.accountNotifications.title', description: 'seo.accountNotifications.description' },
  '/account/security': { title: 'seo.accountSecurity.title', description: 'seo.accountSecurity.description' },
  '/account/trips': { title: 'seo.accountTrips.title', description: 'seo.accountTrips.description' },
  '/account/feedback': { title: 'seo.accountFeedback.title', description: 'seo.accountFeedback.description' },
  '/map': { title: 'seo.map.title', description: 'seo.map.description' },
  '/login': { title: 'seo.login.title', description: 'seo.login.description' },
  '/compare': { title: 'seo.compare.title', description: 'seo.compare.description' },
}

export function RouteMeta() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { lang } = useApp()
  useEffect(() => {
    // Match either exact path or prefix for parameterized routes
    let meta = ROUTE_META[pathname]
    if (!meta) {
      if (pathname.startsWith('/trips/')) {
        meta = { title: 'seo.tripDetail.title', description: 'seo.tripDetail.description' }
      } else if (pathname.startsWith('/brands/')) {
        meta = { title: 'seo.brandDetail.title', description: 'seo.brandDetail.description' }
      } else if (pathname.startsWith('/bookings/')) {
        meta = { title: 'seo.bookingDetail.title', description: 'seo.bookingDetail.description' }
      } else {
        meta = { title: 'seo.default.title', description: ROUTE_META['/'].description }
      }
    }
    if (typeof document !== 'undefined') {
      const title = translate(lang, meta.title)
      document.title = title
      const descTag = document.querySelector('meta[name="description"]')
      if (descTag) descTag.setAttribute('content', translate(lang, meta.description))

      // ── noindex for private routes (UIUX-017) ───────────────
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
        trackPageView(pathname, title)
      }
    }
  }, [pathname, lang])
  return null
}
