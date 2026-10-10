import { Suspense, useEffect } from 'react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { IslandFallback } from '@/components/island-fallback'
import { useAuthMe } from '@/features/auth/api'
import { cn } from '@/lib/utils'
import { useBookingFlow } from '@/stores/booking-flow'
import { useSession } from '@/stores/session'
import { Header } from './layout/header'
import { Deferred, Footer, MobileNav, Overlays, SupportFab } from './overlays'
import { RouteMeta } from './route-meta'

/** Back to the top on navigation — but not when only the search params change. */
function ScrollToTop() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/** Keeps the cached session in step with the server and locks scroll behind the booking flow. */
function SessionSync() {
  const user = useSession((s) => s.user)
  const setUser = useSession((s) => s.setUser)
  const bookingOpen = useBookingFlow((s) => s.step !== 'idle')
  const { data, isLoading, isError } = useAuthMe()

  useEffect(() => {
    if (isLoading) return
    if (isError || !data) {
      if (user) setUser(null)
    } else {
      setUser(data.user)
    }
  }, [data, isLoading, isError]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.body.style.overflow = bookingOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [bookingOpen])

  return null
}

/** Customer chrome (header, footer, mobile nav, overlays) around every page; the admin console brings its own shell. */
export function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // The admin console brings its own frame; the account area lives in the site chrome.
  const ownShell = pathname.startsWith('/admin')

  return (
    // Every page sits on the soft canvas; white cards lift off it.
    <div className="flex min-h-screen flex-col bg-canvas">
      <RouteMeta />
      <ScrollToTop />
      <SessionSync />
      {!ownShell && <Header />}

      <main
        id="main-content"
        tabIndex={-1}
        // Clears the customer MobileNav bar (4rem) and the iOS home indicator.
        className={cn(
          'flex-1 outline-none',
          !ownShell && 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0',
        )}
      >
        <Suspense fallback={<IslandFallback minHeight={500} />}>
          <Outlet />
        </Suspense>
      </main>

      {!ownShell && pathname !== '/login' && !pathname.startsWith('/account') && (
        <Deferred>
          <Footer />
        </Deferred>
      )}
      <Overlays />
      {!ownShell && (
        <>
          <Deferred>
            <MobileNav />
          </Deferred>
          <Deferred>
            <SupportFab />
          </Deferred>
        </>
      )}
    </div>
  )
}
