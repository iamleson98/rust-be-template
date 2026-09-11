/**
 * Root route — app shell + persistent overlays + auth bootstrap.
 *
 * Extracted from the original 'src/router.tsx'.
 *
 * The root component renders the customer Header/Footer + main content
 * outlet plus every persistent lazy overlay (booking dialog, chat, call
 * widget, compare tray, loyalty, cancel, price-alert, share, mobile nav,
 * support FAB). Admin/account routes render inside their own shells, so
 * the customer chrome hides there.
 */

import { Suspense, useEffect } from 'react'
import { Outlet, createRootRoute, useRouterState } from '@tanstack/react-router'
import { useApp, hydrateFromStorage } from '@/lib/store'
import { useAuthMe } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { IslandFallback } from '@/routes/_fallback'
import {
  Header,
  NotFoundPage,
  Footer,
  MobileNav,
  ChatWidget,
  AudioCallWidget,
  BookingDialog,
  TripCompare,
  LoyaltyWidget,
  CancelDialog,
  PriceAlertDialog,
  ShareDialog,
  SupportFab,
} from './lazy-pages'
import { RouteMeta } from './route-meta'

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

export const rootRoute = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => (
    <Suspense fallback={<IslandFallback minHeight={400} />}>
      <NotFoundPage />
    </Suspense>
  ),
})
