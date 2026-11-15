import { describe, expect, it } from 'vitest'
import { mockApi } from '@/test/api'
import { reverseGeocode } from '../geocode'

describe('reverseGeocode', () => {
  it('names the nearest place but keeps the exact point that was clicked', async () => {
    const { last } = mockApi({
      'GET /api/places/reverse': [
        {
          name: 'Bến xe Miền Đông',
          type: 'bus_station',
          province: 'Hồ Chí Minh',
          district: 'Bình Thạnh',
          lat: 10.8,
          lon: 106.71,
        },
      ],
    })
    const place = await reverseGeocode(10.8012, 106.7099)
    expect(place).toEqual({
      name: 'Bến xe Miền Đông',
      lat: 10.8012,
      lon: 106.7099,
      type: 'bus_station',
      province: 'Hồ Chí Minh',
      district: 'Bình Thạnh',
    })
    const query = last('/api/places/reverse')!.url.searchParams
    expect(query.get('lat')).toBe('10.8012')
    expect(query.get('lon')).toBe('106.7099')
    expect(query.get('limit')).toBe('1')
  })

  it('names a point with no known place by its coordinates', async () => {
    mockApi({ 'GET /api/places/reverse': [] })
    expect(await reverseGeocode(21.02851, 105.80482)).toEqual({
      name: '21.029, 105.805',
      lat: 21.02851,
      lon: 105.80482,
    })
  })

  it('falls back to the coordinates when the lookup fails', async () => {
    mockApi({ 'GET /api/places/reverse': Response.json({ error: 'down' }, { status: 503 }) })
    expect(await reverseGeocode(16.0544, 108.2022)).toEqual({
      name: '16.054, 108.202',
      lat: 16.0544,
      lon: 108.2022,
    })
  })
})
