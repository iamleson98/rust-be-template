import { Suspense } from 'react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { AdminContentSkeleton } from './admin-content-skeleton'
import { AdminShell } from './admin-shell'

/** The admin sidebar stays mounted across pages; only the content swaps (skeleton while a page chunk loads). */
export function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <AdminShell>
      <Suspense fallback={<AdminContentSkeleton />}>
        <div key={pathname} className="page-transition h-full">
          <Outlet />
        </div>
      </Suspense>
    </AdminShell>
  )
}
