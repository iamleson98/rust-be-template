/**
 * The schedule form's fares: a seat-class price typed into a new row (the
 * child price untouched, or not even shown when the brand sells no child
 * tickets) must not block saving.
 */
import { describe, expect, it } from 'vitest'
import { scheduleSchema, type ScheduleFormInput } from '../schedule-schema'

const base: ScheduleFormInput = {
  departureTime: '08:00',
  effectiveFrom: '2026-10-01',
  effectiveTo: '2027-10-01',
  days: [true, true, true, true, true, true, true],
  vehicleTypeId: 'vt-1',
  busLayoutId: 'layout-1',
  basePriceAdult: 300000,
  basePriceChild: 0,
  classFares: {},
  amenities: [],
  startPointId: 'a',
  startPointTime: null,
  endPointId: 'b',
  endPointTime: null,
  middlePoints: [],
}

describe('scheduleSchema fares', () => {
  it('saves a class whose child price was never touched', () => {
    const r = scheduleSchema.safeParse({
      ...base,
      classFares: { vip: { priceAdult: '450000' }, premium: { priceAdult: '380000' } },
    })
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    expect(r.data?.classFares).toEqual({
      vip: { priceAdult: 450000, priceChild: 0 },
      premium: { priceAdult: 380000, priceChild: 0 },
    })
  })

  it('treats a cleared field as not set', () => {
    const r = scheduleSchema.safeParse({
      ...base,
      classFares: { vip: { priceAdult: '', priceChild: '' } },
    })
    expect(r.success).toBe(true)
  })

  it('still refuses a child price above the adult one', () => {
    const r = scheduleSchema.safeParse({
      ...base,
      classFares: { vip: { priceAdult: '400000', priceChild: '500000' } },
    })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].path).toEqual(['classFares', 'vip', 'priceChild'])
  })
})
