import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// public/sw.js ships as a plain static file; evaluate it against mocked globals.
const source = readFileSync(resolve(__dirname, '../../../public/sw.js'), 'utf8')

type Listener = (event: unknown) => void
const resp = (status: number, body = '', type = 'basic', ct = 'text/html') => ({
  status,
  type,
  body,
  headers: { get: () => ct },
  clone() {
    return this
  },
})

function setup() {
  const listeners: Record<string, Listener> = {}
  const store = new Map<string, unknown>()
  const caches = {
    open: async () => ({
      put: async (r: { url: string }, v: unknown) => void store.set(r.url, v),
      addAll: async () => undefined,
    }),
    match: async (r: string | { url: string }) =>
      store.get(typeof r === 'string' ? new URL(r, 'https://x.test').href : r.url),
    keys: async () => ['datxevui-runtime-v3', 'datxevui-precache-v4', 'datxevui-runtime-v4'],
    delete: vi.fn(async () => true),
  }
  const fetchMock = vi.fn()
  const self = {
    location: { origin: 'https://x.test' },
    addEventListener: (n: string, l: Listener) => (listeners[n] = l),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  }
  const ResponseMock = { error: () => resp(0, 'error', 'error') }
  new Function('self', 'caches', 'fetch', 'Response', source)(self, caches, fetchMock, ResponseMock)
  const run = async (path: string, mode = 'cors') => {
    let out: Promise<unknown> | undefined
    listeners.fetch({
      request: { url: `https://x.test${path}`, method: 'GET', mode },
      respondWith: (p: Promise<unknown>) => (out = p),
    })
    return out === undefined ? undefined : await out
  }
  return { listeners, store, caches, fetchMock, self, run }
}

describe('service worker', () => {
  let sw: ReturnType<typeof setup>
  beforeEach(() => {
    sw = setup()
  })

  it('drops other-version caches on activate and claims clients', async () => {
    let p: Promise<unknown> = Promise.resolve()
    sw.listeners.activate({ waitUntil: (x: Promise<unknown>) => (p = x) })
    await p
    expect(sw.caches.delete).toHaveBeenCalledTimes(1)
    expect(sw.caches.delete).toHaveBeenCalledWith('datxevui-runtime-v3')
    expect(sw.self.clients.claim).toHaveBeenCalled()
  })

  it.each(['/api/trips', '/ws', '/health', '/ready', '/sw.js'])(
    'does not intercept %s',
    async (p) => {
      expect(await sw.run(p)).toBeUndefined()
    },
  )

  it('navigations hit the network with no-cache and never serve a stale shell', async () => {
    sw.store.set('https://x.test/', resp(200, 'OLD'))
    sw.fetchMock.mockResolvedValue(resp(200, 'NEW'))
    const out = (await sw.run('/', 'navigate')) as { body: string }
    expect(out.body).toBe('NEW')
    expect(sw.fetchMock.mock.calls[0][1]).toEqual({ cache: 'no-cache' })
  })

  it('navigation falls back to the cached shell, then offline.html, when the network fails', async () => {
    sw.fetchMock.mockRejectedValue(new Error('offline'))
    sw.store.set('https://x.test/offline.html', resp(200, 'OFFLINE'))
    expect(((await sw.run('/trips/1', 'navigate')) as { body: string }).body).toBe('OFFLINE')
    sw.store.set('https://x.test/', resp(200, 'SHELL'))
    expect(((await sw.run('/trips/1', 'navigate')) as { body: string }).body).toBe('SHELL')
  })

  it('hashed assets are cache-first and a 404 is never cached', async () => {
    sw.store.set('https://x.test/assets/a-1.js', resp(200, 'CACHED', 'basic', 'text/javascript'))
    expect(((await sw.run('/assets/a-1.js')) as { body: string }).body).toBe('CACHED')
    expect(sw.fetchMock).not.toHaveBeenCalled()

    sw.fetchMock.mockResolvedValue(resp(404, 'nope'))
    await sw.run('/assets/gone-2.js')
    expect(sw.store.has('https://x.test/assets/gone-2.js')).toBe(false)
  })

  it('stores 200 basic assets only', async () => {
    sw.fetchMock.mockResolvedValue(resp(200, 'js', 'basic', 'text/javascript'))
    await sw.run('/assets/ok-3.js')
    await Promise.resolve()
    await Promise.resolve()
    expect(sw.store.has('https://x.test/assets/ok-3.js')).toBe(true)
    sw.fetchMock.mockResolvedValue(resp(200, 'x', 'opaque'))
    await sw.run('/assets/opaque-4.js')
    await Promise.resolve()
    expect(sw.store.has('https://x.test/assets/opaque-4.js')).toBe(false)
  })
})
