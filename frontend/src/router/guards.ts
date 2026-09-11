/**
 * Route guards — auth gating for staff/admin/account areas.
 *
 * Extracted from the original 'src/router.tsx'.
 *
 * Three guard helpers:
 *
 *   requireAuth()   — must be logged in (any user type). If not,
 *                     redirect to /login.
 *   requireStaff()  — must be logged in as staff (employee or
 *                     admin). Otherwise redirect to /login.
 *   requireAdmin()  — must be an admin; employees land on the
 *                     dashboard instead.
 *
 * CRITICAL: the previous guards checked `if (user && user.type !== 'employee')`
 * which is FALSE when `user` is null (unauthenticated). This allowed
 * unauthenticated visitors to access admin pages — the bug we're fixing.
 * The checks use `!user || !isStaff(user)` which correctly
 * blocks both cases: no user at all, or a non-employee user.
 */

import { redirect } from '@tanstack/react-router'
import { useApp } from '@/lib/store'

export function requireAuth() {
  const { user } = useApp.getState()
  if (!user) {
    throw redirect({ to: '/login' })
  }
}

export function requireStaff() {
  const { user } = useApp.getState()
  // Three-role model: employees AND admins are staff; customers are not.
  if (!user || (user.type !== 'employee' && user.type !== 'admin')) {
    throw redirect({ to: '/login' })
  }
}

/** Admin-only guard — the Users page + other governance screens. */
export function requireAdmin() {
  const { user } = useApp.getState()
  if (!user || user.type !== 'admin') {
    // Staff without admin rights land on the dashboard instead.
    if (user && user.type === 'employee') throw redirect({ to: '/admin' })
    throw redirect({ to: '/login' })
  }
}
