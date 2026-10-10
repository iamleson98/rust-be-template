import { describe, expect, it } from 'vitest'
import { buildSearchInput, parseSearch, SEARCH_DEFAULTS, toQuery } from '../search-params'

describe('parseSearch', () => {
  it('applies the defaults to an empty URL', () => {
    expect(toQuery(parseSearch({}))).toMatchObject(SEARCH_DEFAULTS)
  })

  it('reads router-parsed values and URLSearchParams strings alike', () => {
    const typed = parseSearch({ adults: 3, children: 1, roundTrip: true, sort: 'price' })
    const strings = parseSearch(
      Object.fromEntries(new URLSearchParams('adults=3&children=1&roundTrip=true&sort=price')),
    )
    expect(typed).toEqual(strings)
    expect(typed).toMatchObject({ adults: 3, children: 1, roundTrip: true, sort: 'price' })
  })

  it('falls back instead of throwing on junk', () => {
    expect(
      parseSearch({
        from: 42,
        date: 'tomorrow',
        returnDate: '2026-13',
        adults: 'many',
        children: -5,
        sort: 'cheapest',
        roundTrip: 'nope',
      }),
    ).toMatchObject({
      from: '',
      date: '',
      returnDate: '',
      adults: 1,
      children: 0,
      sort: 'departure',
      roundTrip: false,
    })
    expect(parseSearch({ adults: 0 }).adults).toBe(1)
    expect(parseSearch({ adults: '2.9' }).adults).toBe(2)
  })

  it('accepts a valid date and the legacy 1/true round-trip flags', () => {
    expect(parseSearch({ date: '2026-10-10', roundTrip: '1' })).toMatchObject({
      date: '2026-10-10',
      roundTrip: true,
    })
  })

  it('reads vehicle types from the router JSON, the legacy vt= list, or an array', () => {
    expect(parseSearch({ vehicleTypes: ['limousine', 'sleeper'] }).vehicleTypes).toEqual([
      'limousine',
      'sleeper',
    ])
    expect(parseSearch({ vehicleTypes: '["limousine"]' }).vehicleTypes).toEqual(['limousine'])
    expect(parseSearch({ vt: 'limousine, sleeper,' }).vehicleTypes).toEqual([
      'limousine',
      'sleeper',
    ])
    expect(parseSearch({ vehicleTypes: '[oops' }).vehicleTypes).toEqual(['[oops'])
    expect(parseSearch({ vehicleTypes: 7 }).vehicleTypes).toEqual([])
  })

  it('keeps coordinates only when all four are valid numbers', () => {
    const geo = parseSearch({ fromLat: '10.5', fromLon: 106.7, toLat: 21, toLon: '105.8' })
    expect([geo.fromLat, geo.fromLon, geo.toLat, geo.toLon]).toEqual([10.5, 106.7, 21, 105.8])
    const half = parseSearch({ fromLat: 10.5, fromLon: 106.7, toLat: 21 })
    expect([half.fromLat, half.fromLon, half.toLat, half.toLon]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(parseSearch({ fromLat: '', fromLon: '', toLat: '', toLon: '' }).fromLat).toBeUndefined()
  })

  it('keeps the city fallbacks', () => {
    expect(parseSearch({ fromCity: 'Hà Nội', toCity: '' })).toMatchObject({
      fromCity: 'Hà Nội',
      toCity: undefined,
    })
  })
})

describe('toQuery', () => {
  it('writes vehicle types as one comma-separated vt', () => {
    const query = toQuery(parseSearch({ vehicleTypes: ['limousine', 'sleeper'] }))
    expect(query.vt).toBe('limousine,sleeper')
    expect(query).not.toHaveProperty('vehicleTypes')
  })

  it('round-trips through parseSearch', () => {
    const params = parseSearch({ from: 'A', adults: 2, vt: 'limousine,sleeper', roundTrip: '1' })
    expect(parseSearch(toQuery(params))).toEqual(params)
  })
})

describe('buildSearchInput', () => {
  const geo = { fromLat: 1, fromLon: 2, toLat: 3, toLon: 4 }

  it('passes plain searches through', () => {
    expect(buildSearchInput({ from: 'A', to: 'B', date: '2026-10-10' })).toEqual({
      from: 'A',
      to: 'B',
      date: '2026-10-10',
    })
  })

  // A `vehicleTypes` array in the URL used to be dropped by the route's
  // validator, so sidebar filters never reached the results.
  it('emits the canonical vt string for vehicle types, never an array', () => {
    const out = buildSearchInput({ from: 'A', to: 'B', vehicleTypes: ['limousine', 'sleeper'] })
    expect(out.vt).toBe('limousine,sleeper')
    expect(out).not.toHaveProperty('vehicleTypes')
  })

  it('omits vt when no vehicle types are selected', () => {
    expect(buildSearchInput({ from: 'A', vehicleTypes: [] })).not.toHaveProperty('vt')
  })

  it('drops default values for a clean URL', () => {
    const out = buildSearchInput({
      from: 'Hà Nội',
      to: 'Đà Nẵng',
      date: '2026-10-10',
      adults: 1,
      children: 0,
      sort: 'departure',
      roundTrip: false,
    })
    expect(out).toEqual({ from: 'Hà Nội', to: 'Đà Nẵng', date: '2026-10-10' })
  })

  it('keeps coordinates when both ends are precise, dropping the city fallbacks', () => {
    expect(
      buildSearchInput({ from: 'Bến xe A', to: 'Bến xe B', ...geo, fromCity: 'X', toCity: 'Y' }),
    ).toEqual({
      from: 'Bến xe A',
      to: 'Bến xe B',
      ...geo,
    })
  })

  it('keeps vt through the precise-pick branch', () => {
    const out = buildSearchInput({
      from: 'Bến xe A',
      to: 'Bến xe B',
      vehicleTypes: ['limousine'],
      ...geo,
    })
    expect(out).toMatchObject({ vt: 'limousine', fromLat: 1 })
  })

  it('degrades a mixed pick to its cities and drops the half coordinates', () => {
    expect(
      buildSearchInput({
        from: 'Bến xe A',
        to: 'Đà Nẵng',
        fromLat: 1,
        fromLon: 2,
        fromCity: 'Hà Nội',
      }),
    ).toEqual({ from: 'Hà Nội', to: 'Đà Nẵng' })
  })
})
