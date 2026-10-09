import { describe, expect, it } from 'vitest'
import type { TripResult } from '@/api'
import {
  activeFilterCount,
  applyFilters,
  brandOptions,
  departureHour,
  effectiveRange,
  inTimeRange,
  NO_FILTERS,
  priceBounds,
  toggle,
  type Filters,
} from '../filters'

const trip = (over: Partial<TripResult>): TripResult =>
  ({
    tripId: 't',
    minPrice: 200_000,
    maxPrice: 260_000,
    brandRating: 4.5,
    brandSlug: 'a',
    brandName: 'A',
    availableSeats: 12,
    amenities: ['wifi'],
    departureTime: '08:30',
    ...over,
  }) as TripResult

const results = [
  trip({
    tripId: '1',
    minPrice: 180_000,
    maxPrice: 220_000,
    departureTime: '05:10',
    brandSlug: 'a',
  }),
  trip({
    tripId: '2',
    minPrice: 320_000,
    maxPrice: 410_000,
    departureTime: '14:00',
    brandSlug: 'b',
    brandName: 'B',
    brandRating: 4.8,
    availableSeats: 3,
  }),
  trip({
    tripId: '3',
    minPrice: 250_000,
    maxPrice: 300_000,
    departureTime: '21:45',
    brandSlug: 'b',
    brandName: 'B',
    amenities: ['wifi', 'ac'],
  }),
]
const bounds = priceBounds(results)
const run = (f: Partial<Filters>) => {
  const filters = { ...NO_FILTERS, ...f }
  return applyFilters(results, filters, effectiveRange(filters, bounds)).map((r) => r.tripId)
}

describe('price range', () => {
  it('rounds the bounds out to the slider step', () => {
    expect(bounds).toEqual([150_000, 450_000])
    expect(priceBounds([])).toEqual([0, 1_000_000])
  })

  it('follows the bounds until the user picks a range, and clamps stale picks', () => {
    expect(effectiveRange(NO_FILTERS, bounds)).toEqual(bounds)
    expect(effectiveRange({ ...NO_FILTERS, priceMin: 200_000, priceMax: 300_000 }, bounds)).toEqual(
      [200_000, 300_000],
    )
    expect(effectiveRange({ ...NO_FILTERS, priceMin: 100_000, priceMax: 900_000 }, bounds)).toEqual(
      bounds,
    )
  })
})

describe('applyFilters', () => {
  it('keeps everything without filters', () => {
    expect(run({})).toEqual(['1', '2', '3'])
  })

  it('filters by the price range on the cheapest fare', () => {
    expect(run({ priceMin: 200_000, priceMax: 300_000 })).toEqual(['3'])
  })

  it('filters by departure time-of-day, any of the chosen ranges', () => {
    expect(run({ timeRanges: ['0-6'] })).toEqual(['1'])
    expect(run({ timeRanges: ['0-6', '18-24'] })).toEqual(['1', '3'])
  })

  it('filters by rating, brand, availability and amenities (all required)', () => {
    expect(run({ minRating: 4.8 })).toEqual(['2'])
    expect(run({ brands: ['b'] })).toEqual(['2', '3'])
    expect(run({ availableOnly: true })).toEqual(['1', '3'])
    expect(run({ amenities: ['wifi', 'ac'] })).toEqual(['3'])
  })

  it('combines filters', () => {
    expect(run({ brands: ['b'], availableOnly: true })).toEqual(['3'])
  })
})

describe('helpers', () => {
  it('reads the departure hour from the timestamp or the HH:mm text', () => {
    expect(departureHour(trip({ departureTime: '07:05' }))).toBe(7)
    expect(departureHour(trip({ departureTime: undefined }))).toBe(12)
    expect(departureHour(trip({ departureAt: new Date(2026, 9, 10, 22, 30).toISOString() }))).toBe(
      22,
    )
  })

  it('treats time ranges as [start, end)', () => {
    expect(inTimeRange(6, '6-12')).toBe(true)
    expect(inTimeRange(12, '6-12')).toBe(false)
  })

  it('counts a price range once and everything else per value', () => {
    const f: Filters = {
      ...NO_FILTERS,
      priceMin: 200_000,
      timeRanges: ['0-6', '6-12'],
      brands: ['a'],
      availableOnly: true,
    }
    expect(activeFilterCount(f, effectiveRange(f, bounds), bounds)).toBe(5)
    expect(activeFilterCount(NO_FILTERS, bounds, bounds)).toBe(0)
  })

  it('toggles list membership', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('lists brands busiest first', () => {
    expect(brandOptions(results)).toEqual([
      { slug: 'b', name: 'B', count: 2 },
      { slug: 'a', name: 'A', count: 1 },
    ])
  })
})
