import { redirect, type ParsedLocation } from '@tanstack/react-router'
import { isAdminUser, isStaffUser, useSession } from '@/stores/session'

type Guard = { location: ParsedLocation }

/** To the login page, coming back here afterwards. */
const toLogin = (location: ParsedLocation) =>
  redirect({ to: '/login', search: { redirect: location.href } })

/** Signed-in customers, employees and admins. */
export function requireAuth({ location }: Guard) {
  if (!useSession.getState().user) throw toLogin(location)
}

/** Employees and admins; everyone else goes to the login page. */
export function requireStaff({ location }: Guard) {
  if (!isStaffUser(useSession.getState().user)) throw toLogin(location)
}

/** Admins only; an employee lands on the dashboard instead. */
export function requireAdmin({ location }: Guard) {
  const user = useSession.getState().user
  if (isAdminUser(user)) return
  if (isStaffUser(user)) throw redirect({ to: '/admin' })
  throw toLogin(location)
}
