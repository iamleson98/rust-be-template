import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { TripResult } from '@/api'
import { fromSearchCache } from '../use-compare-trips'

const row = (tripId: string) => ({ tripId }) as TripResult
const searchKey = (n: number) => [{ _id: 'searchTrips', tags: ['search'], n }]

describe('fromSearchCache', () => {
  it('finds a trip in a paged (infinite) search as well as a plain one', () => {
    const client = new QueryClient()
    client.setQueryData(searchKey(1), {
      pages: [{ items: [row('a')] }, { items: [row('b')] }],
      pageParams: [0, 1],
    })
    client.setQueryData(searchKey(2), { items: [row('c')] })

    expect(fromSearchCache(client, 'b')?.tripId).toBe('b')
    expect(fromSearchCache(client, 'c')?.tripId).toBe('c')
    expect(fromSearchCache(client, 'z')).toBeUndefined()
  })
})
