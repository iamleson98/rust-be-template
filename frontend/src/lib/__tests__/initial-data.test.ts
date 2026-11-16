import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { brandsOptions, recommendationsOptions, routesOptions, statsOptions } from '@/api'
import { INITIAL_DATA_ID, primeFromServer } from '@/lib/initial-data'

/** A document whose root holds the script the server writes into the home page. */
function pageWith(json: string | null): Document {
  const doc = document.implementation.createHTMLDocument('')
  if (json !== null) {
    const script = doc.createElement('script')
    script.type = 'application/json'
    script.id = INITIAL_DATA_ID
    script.textContent = json
    doc.body.append(script)
  }
  return doc
}

const NOW = 1_800_000_000_000

describe('primeFromServer', () => {
  it('puts what the server embedded under the keys the screens read, stamped with its age', () => {
    const queryClient = new QueryClient()
    const stats = { brands: 3, routes: 5, trips: 40 }
    const routes = { items: [{ id: 'r1' }] }
    primeFromServer(
      queryClient,
      pageWith(JSON.stringify({ generatedAt: NOW, stats, routes, brands: { items: [] } })),
    )
    expect(queryClient.getQueryData(statsOptions().queryKey)).toEqual(stats)
    expect(queryClient.getQueryData(routesOptions().queryKey)).toEqual(routes)
    expect(queryClient.getQueryData(brandsOptions().queryKey)).toEqual({ items: [] })
    expect(queryClient.getQueryState(statsOptions().queryKey)?.dataUpdatedAt).toBe(NOW)
  })

  it('leaves out what the server could not read, so the screen asks for it', () => {
    const queryClient = new QueryClient()
    primeFromServer(queryClient, pageWith(JSON.stringify({ generatedAt: NOW, stats: null })))
    expect(queryClient.getQueryData(statsOptions().queryKey)).toBeUndefined()
    expect(queryClient.getQueryData(recommendationsOptions().queryKey)).toBeUndefined()
  })

  it('ignores a page without the data, broken JSON, and data with no age', () => {
    for (const page of [
      pageWith(null),
      pageWith('{not json'),
      pageWith(JSON.stringify({ stats: { brands: 1, routes: 1, trips: 1 } })),
    ]) {
      const queryClient = new QueryClient()
      primeFromServer(queryClient, page)
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    }
  })
})
