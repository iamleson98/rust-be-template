/**
 * Admin routes — the /admin layout + child panels.
 *
 * Extracted from the original 'src/router.tsx'.
 *
 * All /admin/* pages render INSIDE the admin layout: the AdminShell
 * (sidebar + top bar) mounts ONCE and stays mounted across admin
 * navigations — only the content area swaps. The Suspense fallback is a
 * structure-matched skeleton (toolbar + table + pagination), so lazy
 * chunk loads never flash a blank white page. The staff guard lives on
 * the layout, so every child inherits it.
 */

import { Suspense } from 'react'
import { Outlet, createRoute } from '@tanstack/react-router'
import { AdminShell, AdminContentSkeleton } from './lazy-pages'
import {
  AdminPage,
  AdminBrandsPage,
  AdminRoutesPage,
  AdminSchedulesPage,
  AdminVehicleTypesPage,
  AdminCronJobsPage,
  AdminTicketsPage,
  AdminChatPage,
  AdminFeedbackPage,
  AdminBusLayoutsPage,
  AdminSystemPage,
  AdminUsersPage,
  AdminPaymentsPage,
} from './lazy-pages'
import { requireStaff, requireAdmin } from './guards'
import { rootRoute } from './root-route'

export const adminLayoutRoute = createRoute({
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
export const adminIndexRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminPage />
    </Suspense>
  ),
})

export const adminBrandsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/brands',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminBrandsPage />
    </Suspense>
  ),
})

export const adminRoutesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/routes',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminRoutesPage />
    </Suspense>
  ),
})

export const adminSchedulesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/schedules',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminSchedulesPage />
    </Suspense>
  ),
})

// Admin route — vehicle type catalog (schedule form's "Loại xe" picker).
export const adminVehicleTypesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/vehicle-types',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminVehicleTypesPage />
    </Suspense>
  ),
})

// Admin route — cron jobs (recurring background jobs, e.g. the OSM import).
export const adminCronJobsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/cron-jobs',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminCronJobsPage />
    </Suspense>
  ),
})

export const adminTicketsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/tickets',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminTicketsPage />
    </Suspense>
  ),
})

export const adminChatRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/chat',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminChatPage />
    </Suspense>
  ),
})

export const adminFeedbackRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/feedback',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminFeedbackPage />
    </Suspense>
  ),
})

export const adminBusLayoutsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/bus-layouts',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminBusLayoutsPage />
    </Suspense>
  ),
})

export const adminSystemRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/system',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminSystemPage />
    </Suspense>
  ),
})

// Users admin page — ADMIN only (employees redirect to the dashboard).
export const adminUsersRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/users',
  beforeLoad: requireAdmin,
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminUsersPage />
    </Suspense>
  ),
})

export const adminPaymentsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/payments',
  component: () => (
    <Suspense fallback={<AdminContentSkeleton />}>
      <AdminPaymentsPage />
    </Suspense>
  ),
})
