import { redirect } from '@tanstack/react-router'
import { isAdminUser, isStaffUser, useSession } from '@/stores/session'

/** Signed-in customers, employees and admins. */
export function requireAuth() {
  if (!useSession.getState().user) throw redirect({ to: '/login' })
}

/** Employees and admins; everyone else goes to the login page. */
export function requireStaff() {
  if (!isStaffUser(useSession.getState().user)) throw redirect({ to: '/login' })
}

/** Admins only; an employee lands on the dashboard instead. */
export function requireAdmin() {
  const user = useSession.getState().user
  if (isAdminUser(user)) return
  throw redirect({ to: isStaffUser(user) ? '/admin' : '/login' })
}
