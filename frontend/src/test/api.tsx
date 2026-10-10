import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { client } from '@/api/generated/client.gen'

type Handler = unknown | ((url: URL, request: Request) => unknown)

/**
 * Serve fake API responses to the generated SDK. Keys are `"GET /api/path"`;
 * a value is a JSON body, a `Response`, or a function returning either.
 * Returns every request made so tests can assert on query params.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: { method: string; url: URL }[] = []
  client.setConfig({
    baseUrl: 'http://api.test',
    fetch: async (input: RequestInfo | URL) => {
      const request = input as Request
      const url = new URL(request.url)
      calls.push({ method: request.method, url })
      const handler = handlers[`${request.method} ${url.pathname}`]
      if (handler === undefined) return Response.json({ error: 'not mocked' }, { status: 404 })
      const body = typeof handler === 'function' ? handler(url, request) : handler
      return body instanceof Response ? body : Response.json(body)
    },
  })
  return { calls, last: (path: string) => calls.filter((c) => c.url.pathname === path).at(-1) }
}

export function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
