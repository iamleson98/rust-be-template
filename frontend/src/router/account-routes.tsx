/**
 * Account routes — the /account layout + child pages.
 *
 * Extracted from the original 'src/router.tsx'.
 *
 * Same pattern as the admin layout: the AccountShell (side nav +
 * gradient header) stays mounted; only the content area swaps with a
 * structure-matched skeleton fallback. The auth guard lives on the
 * layout so every child inherits it.
 */

import { Suspense } from 'react'
import { Outlet, createRoute } from '@tanstack/react-router'
import { AccountShell, AccountContentSkeleton } from './lazy-pages'
import {
  AccountPage,
  AccountWishlistPage,
  AccountLoyaltyPage,
  AccountNotificationsPage,
  AccountSecurityPage,
  AccountTripsPage,
  AccountFeedbackPage,
} from './lazy-pages'
import { requireAuth } from './guards'
import { rootRoute } from './root-route'

export const accountLayoutRoute = createRoute({
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
export const accountIndexRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountPage />
    </Suspense>
  ),
})

export const accountWishlistRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/wishlist',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountWishlistPage />
    </Suspense>
  ),
})

export const accountLoyaltyRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/loyalty',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountLoyaltyPage />
    </Suspense>
  ),
})

export const accountNotificationsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/notifications',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountNotificationsPage />
    </Suspense>
  ),
})

export const accountSecurityRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/security',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountSecurityPage />
    </Suspense>
  ),
})

export const accountTripsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/trips',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountTripsPage />
    </Suspense>
  ),
})

// Feedback history — the user's submitted trip reviews (star ratings).
export const accountFeedbackRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/feedback',
  component: () => (
    <Suspense fallback={<AccountContentSkeleton />}>
      <AccountFeedbackPage />
    </Suspense>
  ),
})
