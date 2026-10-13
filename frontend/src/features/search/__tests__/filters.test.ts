import { describe, expect, it } from 'vitest'
import type { SearchFacets } from '@/api'
import {
  activeFilterCount,
  effectiveRange,
  facetCount,
  filterQuery,
  NO_FILTERS,
  priceBounds,
  toggle,
  type Filters,
} from '../filters'

const facets = (over: Partial<SearchFacets> = {}): SearchFacets => ({
  matches: 3,
  priceMin: 180_000,
  priceMax: 420_000,
  brands: [],
  vehicleTypes: [],
  hours: [
    { key: '0-6', label: '0-6', count: 1 },
    { key: '6-12', label: '6-12', count: 2 },
  ],
  amenities: [],
  plentyOfSeats: 2,
  ...over,
})

describe('priceBounds', () => {
  it('spans every match, rounded out to the slider step', () => {
    expect(priceBounds(facets())).toEqual([150_000, 450_000])
  })

  it('falls back to a fixed range before results or without matches', () => {
    expect(priceBounds(undefined)).toEqual([0, 1_000_000])
    expect(priceBounds(facets({ matches: 0, priceMin: 0, priceMax: 0 }))).toEqual([0, 1_000_000])
  })
})

describe('effectiveRange', () => {
  it('follows the bounds until a range is picked, and clamps a picked one', () => {
    expect(effectiveRange(NO_FILTERS, [150_000, 450_000])).toEqual([150_000, 450_000])
    const picked: Filters = { ...NO_FILTERS, priceMin: 100_000, priceMax: 300_000 }
    expect(effectiveRange(picked, [150_000, 450_000])).toEqual([150_000, 300_000])
  })
})

describe('filterQuery', () => {
  it('sends nothing for no filters', () => {
    expect(Object.values(filterQuery(NO_FILTERS)).every((v) => v === undefined)).toBe(true)
  })

  it('sends every picked filter in the API form', () => {
    const f: Filters = {
      priceMin: 200_000,
      priceMax: 300_000,
      timeRanges: ['6-12', '18-24'],
      minRating: 4.5,
      availableOnly: true,
      amenities: ['wifi', 'water'],
      brands: ['nha-xe-an'],
    }
    expect(filterQuery(f)).toEqual({
      brands: 'nha-xe-an',
      priceMin: 200_000,
      priceMax: 300_000,
      hours: '6-12,18-24',
      minRating: 4.5,
      plentyOfSeats: true,
      amenities: 'wifi,water',
    })
  })
})

describe('activeFilterCount', () => {
  it('counts a narrowed price range once and every other value', () => {
    const bounds: [number, number] = [150_000, 450_000]
    const f: Filters = { ...NO_FILTERS, timeRanges: ['6-12'], brands: ['a', 'b'] }
    expect(activeFilterCount(f, bounds, bounds)).toBe(3)
    expect(activeFilterCount(f, [200_000, 450_000], bounds)).toBe(4)
  })
})

describe('helpers', () => {
  it('reads a facet count, 0 when absent', () => {
    expect(facetCount(facets().hours, '6-12')).toBe(2)
    expect(facetCount(facets().hours, '18-24')).toBe(0)
    expect(facetCount(undefined, '6-12')).toBe(0)
  })

  it('toggles a value in and out of a list', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  })
})
