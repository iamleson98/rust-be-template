/**
 * A mutation refreshes its own resource and the lists that show it: a
 * schedule change on the brands page reaches the route row and the brand
 * row above it.
 */
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '../query-client'

const key = (id: string, tag: string) => [{ _id: id, tags: [tag] }]

describe('query client refresh map', () => {
  it('a schedule change marks the route and brand lists stale', async () => {
    const qc = createQueryClient()
    for (const [id, tag] of [
      ['adminBrandsList', 'adminBrands'],
      ['adminRoutesList', 'adminRoutes'],
      ['adminSchedulesList', 'adminSchedules'],
      ['adminVehicleTypesList', 'adminVehicleTypes'],
    ]) {
      qc.setQueryData(key(id, tag), { items: [] })
    }

    await qc
      .getMutationCache()
      .build(qc, { mutationFn: async () => ({}), meta: { resource: 'adminSchedules' } })
      .execute(undefined)

    const stale = (id: string, tag: string) => qc.getQueryState(key(id, tag))?.isInvalidated
    expect(stale('adminSchedulesList', 'adminSchedules')).toBe(true)
    expect(stale('adminRoutesList', 'adminRoutes')).toBe(true)
    expect(stale('adminBrandsList', 'adminBrands')).toBe(true)
    expect(stale('adminVehicleTypesList', 'adminVehicleTypes')).toBe(false)
  })
})
