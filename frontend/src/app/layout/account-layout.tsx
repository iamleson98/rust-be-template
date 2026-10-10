import { Suspense } from 'react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { AccountContentSkeleton } from './account-content-skeleton'
import { AccountShell } from './account-shell'

/** The account nav stays mounted across pages; only the content swaps (skeleton while a page chunk loads). */
export function AccountLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <AccountShell>
      <Suspense fallback={<AccountContentSkeleton />}>
        <div key={pathname} className="page-transition h-full">
          <Outlet />
        </div>
      </Suspense>
    </AccountShell>
  )
}
