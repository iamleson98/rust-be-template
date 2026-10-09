import { describe, expect, it } from 'vitest'
import type { TripDetail } from '@/api'
import { hhmm, minutesBetween, tripStops } from '../trip-stops'

const detail = (over: Partial<TripDetail>): TripDetail =>
  ({
    trip: { id: 't', departureDate: '2026-10-10', departureTime: '08:30', status: 'scheduled' },
    from: { name: 'Hà Nội', lat: 0, lon: 0 },
    to: { name: 'Đà Nẵng', lat: 0, lon: 0 },
    pickupPoints: [],
    schedulePoints: [],
    ...over,
  }) as TripDetail

describe('trip stops', () => {
  it('reads times', () => {
    expect(hhmm('8:05:00')).toBe('08:05')
    expect(hhmm('soon')).toBeNull()
    expect(minutesBetween('22:30', '01:00')).toBe(150)
    expect(minutesBetween('08:00', null)).toBeNull()
  })

  it('prefers the schedule timetable', () => {
    const { stops, timetable } = tripStops(
      detail({
        schedulePoints: [
          {
            id: 'b',
            stopOrder: 2,
            kind: 'drop',
            name: 'Bến xe B',
            lat: 0,
            lon: 0,
            arrivalTime: '14:00',
          },
          {
            id: 'a',
            stopOrder: 1,
            kind: 'pickup',
            name: 'Bến xe A',
            lat: 0,
            lon: 0,
            arrivalTime: '08:30',
          },
        ],
      }),
    )
    expect(timetable).toBe(true)
    expect(stops.map((s) => [s.name, s.time, s.role])).toEqual([
      ['Bến xe A', '08:30', 'start'],
      ['Bến xe B', '14:00', 'end'],
    ])
  })

  it('falls back to the cities, timed by the trip only', () => {
    const { stops, timetable } = tripStops(detail({}))
    expect(timetable).toBe(false)
    expect(stops.map((s) => [s.name, s.time])).toEqual([
      ['Hà Nội', '08:30'],
      ['Đà Nẵng', null],
    ])
  })
})
