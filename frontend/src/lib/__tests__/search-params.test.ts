/**
 * Regression tests for `buildSearchInput` — the /search URL builder.
 *
 * The vehicle-type filter used to be emitted as a `vehicleTypes` ARRAY
 * param, which the route's `validateSearch` silently dropped (it only
 * reads the canonical `vt` string) — sidebar filter changes never
 * reached the URL, so the results never refiltered. These tests pin
 * the canonical wire format.
 */
import { describe, expect, it } from 'vitest'
import { buildSearchInput } from '../search-params'

describe('buildSearchInput', () => {
  it('emits the canonical vt string for vehicle-type filters', () => {
    const out = buildSearchInput({
      from: 'Hà Nội',
      to: 'Đà Nẵng',
      date: '2026-10-10',
      vehicleTypes: ['limousine', 'sleeper'],
    })
    expect(out.vt).toBe('limousine,sleeper')
    // NEVER an array param — the route validator drops those.
    expect((out as Record<string, unknown>).vehicleTypes).toBeUndefined()
  })

  it('omits vt when no vehicle types are selected', () => {
    const out = buildSearchInput({ from: 'A', to: 'B', date: '2026-10-10', vehicleTypes: [] })
    expect(out.vt).toBeUndefined()
  })

  it('keeps vt through the smart-search (geo) branch', () => {
    const out = buildSearchInput({
      from: 'Bến xe Miền Đông',
      to: 'Bến xe Nước Ngầm',
      date: '2026-10-10',
      vehicleTypes: ['limousine'],
      fromLat: 10.7801,
      fromLon: 106.7019,
      toLat: 20.9869,
      toLon: 105.7757,
    })
    // geo branch returns early — vt must still ride along
    expect(out.vt).toBe('limousine')
    expect(out.fromLat).toBe(10.7801)
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
    expect(out.adults).toBeUndefined()
    expect(out.children).toBeUndefined()
    expect(out.sort).toBeUndefined()
    expect(out.roundTrip).toBeUndefined()
  })

  it('degrades a mixed pick to city names (no half-geo search)', () => {
    const out = buildSearchInput({
      from: 'Bến xe Miền Đông',
      to: 'Đà Nẵng',
      date: '2026-10-10',
      fromLat: 10.7801,
      fromLon: 106.7019,
      fromCity: 'TP. Hồ Chí Minh',
    })
    expect(out.fromLat).toBeUndefined()
    expect(out.from).toBe('TP. Hồ Chí Minh')
    expect(out.to).toBe('Đà Nẵng')
  })
})
