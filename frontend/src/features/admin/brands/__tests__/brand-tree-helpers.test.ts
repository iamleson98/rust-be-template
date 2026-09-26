import { describe, expect, it } from 'vitest'

import {
  brandMatchesRouteFilter,
  dayChips,
  daysLabel,
  effectiveWindow,
  matchesBrandSearch,
  nextScheduleSort,
  routeDirection,
  schedulePointsSummary,
  scheduleStopTimes,
  sortSchedules,
  vehicleCodeLabel,
  vehicleLabelFor,
  type ScheduleSort,
} from '../brand-tree-helpers'
import type { AdminScheduleOut } from '@/lib/api/types.gen'

function schedule(overrides: Partial<AdminScheduleOut> = {}): AdminScheduleOut {
  return {
    id: 's1',
    routeId: 'r1',
    departureTime: '08:00',
    effectiveFrom: '2026-10-01',
    effectiveTo: '2026-12-01',
    daysOfWeek: '1111111',
    busLayoutId: null,
    vehicleTypeId: null,
    vehicleType: null,
    basePriceAdult: 100000,
    basePriceChild: 50000,
    amenities: null,
    points: [],
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('matchesBrandSearch', () => {
  const brand = { name: 'Phương Trang', slug: 'phuong-trang', contactPhone: '1900 6067' }

  it('matches everything when the query is blank', () => {
    expect(matchesBrandSearch(brand, '')).toBe(true)
    expect(matchesBrandSearch(brand, '   ')).toBe(true)
  })

  it('matches the name case-insensitively', () => {
    expect(matchesBrandSearch(brand, 'phuong')).toBe(true)
    expect(matchesBrandSearch(brand, 'TRANG')).toBe(true)
  })

  it('matches diacritic-insensitively (folded needle and haystack)', () => {
    expect(matchesBrandSearch(brand, 'phương trang')).toBe(true)
    // 'Đà' folds to 'da' — typing without tones still finds the brand.
    expect(
      matchesBrandSearch({ name: 'Đà Nẵng Express', slug: 'dn-express', contactPhone: null }, 'da nang'),
    ).toBe(true)
  })

  it('matches the slug', () => {
    expect(matchesBrandSearch(brand, 'phuong-trang')).toBe(true)
  })

  it('matches the phone ignoring spaces', () => {
    expect(matchesBrandSearch(brand, '19006067')).toBe(true)
  })

  it('rejects non-matching queries', () => {
    expect(matchesBrandSearch(brand, 'thanh buoi')).toBe(false)
  })
})

describe('brandMatchesRouteFilter', () => {
  it('is true only for brands with a matching route', () => {
    const matching = new Set(['b1', 'b2'])
    expect(brandMatchesRouteFilter({ id: 'b1' }, matching)).toBe(true)
    expect(brandMatchesRouteFilter({ id: 'b3' }, matching)).toBe(false)
  })
})

describe('sortSchedules', () => {
  const schedules = [
    schedule({ id: 'a', departureTime: '21:00', basePriceAdult: 180000, effectiveFrom: '2026-11-01' }),
    schedule({ id: 'b', departureTime: '06:30', basePriceAdult: 350000, effectiveFrom: '2026-10-01' }),
    schedule({ id: 'c', departureTime: '13:45', basePriceAdult: 250000, effectiveFrom: '2026-12-01' }),
  ]

  it('sorts by departure time ascending and descending', () => {
    const asc = sortSchedules(schedules, { key: 'departureTime', dir: 'asc' })
    expect(asc.map((s) => s.departureTime)).toEqual(['06:30', '13:45', '21:00'])
    const desc = sortSchedules(schedules, { key: 'departureTime', dir: 'desc' })
    expect(desc.map((s) => s.departureTime)).toEqual(['21:00', '13:45', '06:30'])
  })

  it('sorts by adult price', () => {
    const asc = sortSchedules(schedules, { key: 'priceAdult', dir: 'asc' })
    expect(asc.map((s) => s.basePriceAdult)).toEqual([180000, 250000, 350000])
  })

  it('sorts by effective date', () => {
    const asc = sortSchedules(schedules, { key: 'effectiveFrom', dir: 'asc' })
    expect(asc.map((s) => s.effectiveFrom)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01'])
  })

  it('never mutates the input array', () => {
    const input = [schedules[0], schedules[1], schedules[2]]
    sortSchedules(input, { key: 'departureTime', dir: 'asc' })
    expect(input[0].id).toBe('a')
  })

  it('treats missing keys as empty (sorts first ascending)', () => {
    const withMissing = [schedule({ id: 'x', departureTime: '09:00' }), schedule({ id: 'y', departureTime: '' })]
    const asc = sortSchedules(withMissing, { key: 'departureTime', dir: 'asc' })
    expect(asc[0].id).toBe('y')
  })
})

describe('nextScheduleSort', () => {
  it('starts asc on a new key', () => {
    expect(nextScheduleSort(null, 'departureTime')).toEqual({ key: 'departureTime', dir: 'asc' })
    const current: ScheduleSort = { key: 'priceAdult', dir: 'asc' }
    expect(nextScheduleSort(current, 'departureTime')).toEqual({ key: 'departureTime', dir: 'asc' })
  })

  it('flips asc → desc on the same key', () => {
    const current: ScheduleSort = { key: 'departureTime', dir: 'asc' }
    expect(nextScheduleSort(current, 'departureTime')).toEqual({ key: 'departureTime', dir: 'desc' })
  })

  it('returns asc after desc on the same key', () => {
    const current: ScheduleSort = { key: 'departureTime', dir: 'desc' }
    expect(nextScheduleSort(current, 'departureTime')).toEqual({ key: 'departureTime', dir: 'asc' })
  })
})

describe('daysLabel / dayChips', () => {
  it('labels the daily bitmask compactly', () => {
    expect(daysLabel('1111111')).toBe('Hàng ngày')
    expect(daysLabel(undefined)).toBe('Hàng ngày')
    expect(daysLabel('0000000')).toBe('Không hoạt động')
    expect(daysLabel('0000011')).toBe('Cuối tuần')
    expect(daysLabel('1111100')).toBe('Ngày thường')
    expect(daysLabel('1000000')).toBe('T2')
    expect(daysLabel('0100001')).toBe('T3, CN')
  })

  it('builds one chip per weekday with the active flag', () => {
    const chips = dayChips('1000001')
    expect(chips).toHaveLength(7)
    expect(chips[0]).toEqual({ label: 'T2', active: true })
    expect(chips[1]).toEqual({ label: 'T3', active: false })
    expect(chips[6]).toEqual({ label: 'CN', active: true })
  })

  it('defaults missing bitmasks to daily', () => {
    expect(dayChips(null).every((c) => c.active)).toBe(true)
  })
})

describe('schedulePointsSummary / scheduleStopTimes', () => {
  const point = (id: string, name: string, arrival: string | null, kind: string) => ({
    id,
    scheduleId: 's1',
    addressId: `addr-${id}`,
    stopOrder: 0,
    kind,
    arrivalTime: arrival,
    address: {
      id: `addr-${id}`,
      brandId: 'b1',
      name,
      address: null,
      lat: 0,
      lon: 0,
      province: null,
      district: null,
      ward: null,
      createdAt: '',
      updatedAt: '',
    },
  })

  it('summarises first → last with the midway count', () => {
    const s = schedule({
      points: [
        point('p1', 'Bến xe Miền Đông', '08:00', 'pickup'),
        point('p2', 'Ngã ba Vũng Tàu', null, 'middle'),
        point('p3', 'Bến xe Nước Ngầm', '14:00', 'drop'),
      ],
    })
    expect(schedulePointsSummary(s)).toBe('Bến xe Miền Đông → Bến xe Nước Ngầm (+1)')
    expect(scheduleStopTimes(s)).toBe('08:00 → 14:00')
  })

  it('omits the midway count for direct trips', () => {
    const s = schedule({
      points: [point('p1', 'A', '08:00', 'pickup'), point('p2', 'B', '20:00', 'drop')],
    })
    expect(schedulePointsSummary(s)).toBe('A → B')
  })

  it('handles missing point sequences and times', () => {
    expect(schedulePointsSummary(schedule())).toBe('—')
    expect(scheduleStopTimes(schedule())).toBe('')
    const partial = schedule({
      points: [point('p1', 'A', null, 'pickup'), point('p2', 'B', null, 'drop')],
    })
    expect(scheduleStopTimes(partial)).toBe('')
  })
})

describe('vehicleLabelFor / vehicleCodeLabel', () => {
  it('prefers the explicit vehicle type row label', () => {
    const s = schedule({
      vehicleType: {
        id: 'vt1',
        code: 'sleeper',
        label: 'Giường nằm',
        description: null,
        totalSeats: 40,
        sortOrder: 5,
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
    })
    expect(vehicleLabelFor(s)).toBe('Giường nằm')
  })

  it('falls back to a dash without a vehicle type', () => {
    expect(vehicleLabelFor(schedule())).toBe('—')
  })

  it('maps legacy vehicle codes to Vietnamese labels', () => {
    expect(vehicleCodeLabel('limousine')).toBe('Limousine')
    expect(vehicleCodeLabel('sleeper')).toBe('Giường nằm')
    expect(vehicleCodeLabel('unknown-code')).toBe('unknown-code')
    expect(vehicleCodeLabel(null)).toBe('—')
  })
})

describe('routeDirection / effectiveWindow', () => {
  it('uses embedded previews with slug fallback', () => {
    expect(
      routeDirection({
        id: 'r',
        brandId: 'b',
        name: 'N',
        startLocationId: 'ha-noi',
        endLocationId: 'da-nang',
        status: 'active',
        createdAt: '',
        updatedAt: '',
        startLocation: { id: 'ha-noi', name: 'Hà Nội', province: 'Hà Nội' },
        endLocation: { id: 'da-nang', name: 'Đà Nẵng', province: 'Đà Nẵng' },
        scheduleCount: 1,
        pickupPointCount: 2,
      }),
    ).toBe('Hà Nội → Đà Nẵng')

    expect(
      routeDirection({
        id: 'r',
        brandId: 'b',
        name: 'N',
        startLocationId: 'ha-noi',
        endLocationId: 'da-nang',
        status: 'active',
        createdAt: '',
        updatedAt: '',
        startLocation: null,
        endLocation: null,
        scheduleCount: 0,
        pickupPointCount: 0,
      }),
    ).toBe('ha-noi → da-nang')
  })

  it('formats the effective window tolerantly', () => {
    expect(effectiveWindow(schedule())).toBe('2026-10-01 → 2026-12-01')
    expect(effectiveWindow(schedule({ effectiveFrom: '2026-10-01', effectiveTo: null }))).toBe('từ 2026-10-01')
    expect(effectiveWindow(schedule({ effectiveFrom: null, effectiveTo: '2026-12-01' }))).toBe('đến 2026-12-01')
    expect(effectiveWindow(schedule({ effectiveFrom: null, effectiveTo: null }))).toBe('—')
  })
})
