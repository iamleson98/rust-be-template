import { create } from 'zustand'
import type { SessionUser } from '@/api'
import { storage } from './storage'

const KEY = 'bus_user'
const ROLES = ['user', 'employee', 'admin']

const isSessionUser = (v: unknown): v is SessionUser =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as SessionUser).id === 'string' &&
  ROLES.includes((v as SessionUser).role)

type SessionState = {
  user: SessionUser | null
  setUser: (user: SessionUser | null) => void
}

/**
 * Fast cache of the signed-in user so route guards work on first paint.
 * `GET /api/auth/me` stays the source of truth (see `AuthBootstrap`).
 */
export const useSession = create<SessionState>((set) => {
  const cached = storage.getJson<unknown>(KEY, null)
  return {
    user: isSessionUser(cached) ? cached : null,
    setUser: (user) => {
      storage.set(KEY, user && JSON.stringify(user))
      set({ user })
    },
  }
})

type MaybeUser = Pick<SessionUser, 'role'> | null | undefined

/** Employees and admins both act as staff (admin console, support chat, calls). */
export const isStaffUser = (user: MaybeUser) => user?.role === 'employee' || user?.role === 'admin'

export const isAdminUser = (user: MaybeUser) => user?.role === 'admin'
