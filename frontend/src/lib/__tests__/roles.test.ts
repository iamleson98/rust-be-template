import { describe, expect, it } from 'vitest'

/**
 * Three-role model unit tests:
 *   - `isStaffUser` recognises employees AND admins as staff
 *     (customers are not), powering the admin-route guard, the chat
 *     hubs' agent registration and the presence system.
 */

import { isAdminUser, isStaffUser } from '@/stores/session'

describe('isStaffUser (three-role model)', () => {
  it('treats employees as staff', () => {
    expect(isStaffUser({ role: 'employee' })).toBe(true)
  })

  it('treats admins as staff (admins are full support agents)', () => {
    expect(isStaffUser({ role: 'admin' })).toBe(true)
  })

  it('treats customers as non-staff', () => {
    expect(isStaffUser({ role: 'user' })).toBe(false)
  })

  it('treats missing / unknown types as non-staff', () => {
    expect(isStaffUser(null)).toBe(false)
    expect(isStaffUser(undefined)).toBe(false)
    // Defensive: an unexpected type string never grants staff access.
    expect(isStaffUser({ role: 'superuser' })).toBe(false)
  })
})

describe('isAdminUser', () => {
  it('is true only for admins', () => {
    expect(isAdminUser({ role: 'admin' })).toBe(true)
    expect(isAdminUser({ role: 'employee' })).toBe(false)
    expect(isAdminUser(null)).toBe(false)
  })
})
