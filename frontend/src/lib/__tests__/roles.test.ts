import { describe, expect, it } from 'vitest'

/**
 * Three-role model unit tests:
 *   - `isStaffUser` recognises employees AND admins as staff
 *     (customers are not), powering the admin-route guard, the chat
 *     hubs' agent registration and the presence system.
 *   - The hydrated user store normalises the legacy `type` values to
 *     the new union without inventing roles.
 */

import { isStaffUser } from '../store'

describe('isStaffUser (three-role model)', () => {
  it('treats employees as staff', () => {
    expect(isStaffUser({ type: 'employee' })).toBe(true)
  })

  it('treats admins as staff (admins are full support agents)', () => {
    expect(isStaffUser({ type: 'admin' })).toBe(true)
  })

  it('treats customers as non-staff', () => {
    expect(isStaffUser({ type: 'user' })).toBe(false)
  })

  it('treats missing / unknown types as non-staff', () => {
    expect(isStaffUser(null)).toBe(false)
    expect(isStaffUser(undefined)).toBe(false)
    // Defensive: an unexpected type string never grants staff access.
    expect(isStaffUser({ type: 'superuser' })).toBe(false)
  })
})
