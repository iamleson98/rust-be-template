/**
 * Service Worker — DatXeVui PWA.
 *
 * Caching strategy:
 *   - Navigations (HTML shell): NETWORK-FIRST. The browser HTTP cache is
 *     bypassed (`cache: 'no-cache'`, i.e. revalidate), so a release is visible
 *     on the first visit. After NAV_TIMEOUT_MS a cached shell may answer while
 *     the network request keeps running; if the network fails, the cached page,
 *     then the cached shell, then /offline.html.
 *   - /assets/* (hashed, immutable): cache-first. Only 200 same-origin
 *     responses are ever stored, so a 404 for a gone chunk is never cached.
 *   - Other same-origin files: stale-while-revalidate, 200 responses only.
 *   - API, WS, health/ready: never intercepted.
 *   - OSM tiles / Google Fonts: cache-first.
 *
 * Lifecycle: install precaches the offline page + shell; activate drops every
 * cache of another VERSION and claims the open pages.
 */

// v4 — v3 and older kept the HTML shell stale-while-revalidate, so a release
// showed the previous release's shell first: those caches must go.
const VERSION = 'v4'
const PRECACHE = `datxevui-precache-${VERSION}`
const RUNTIME = `datxevui-runtime-${VERSION}`
const NAV_TIMEOUT_MS = 3000

const PRECACHE_URLS = ['/', '/offline.html', '/manifest.webmanifest', '/logo.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

const cacheable = (resp) => resp && resp.status === 200 && resp.type === 'basic'

function put(req, resp) {
  const copy = resp.clone()
  return caches
    .open(RUNTIME)
    .then((cache) => cache.put(req, copy))
    .catch(() => undefined)
}

async function offlineFallback(req) {
  return (
    (await caches.match(req)) ||
    (await caches.match('/')) ||
    (await caches.match('/offline.html')) ||
    Response.error()
  )
}

async function navigate(req) {
  // `no-cache` revalidates with the server, so the HTTP cache cannot return an old shell.
  const network = fetch(req, { cache: 'no-cache' }).then((resp) => {
    if (cacheable(resp) && (resp.headers.get('content-type') || '').includes('text/html')) {
      void put(req, resp)
    }
    return resp
  })
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS))
  try {
    const first = await Promise.race([network, timeout])
    if (first) return first
    // Slow network: answer from cache when there is something, else keep waiting.
    const cached = (await caches.match(req)) || (await caches.match('/'))
    if (cached) {
      network.catch(() => undefined)
      return cached
    }
    return await network
  } catch {
    return offlineFallback(req)
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  const resp = await fetch(req)
  if (cacheable(resp)) void put(req, resp)
  return resp
}

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req)
  const network = fetch(req).then((resp) => {
    if (cacheable(resp)) void put(req, resp)
    return resp
  })
  if (cached) {
    network.catch(() => undefined)
    return cached
  }
  return network
}

async function crossOrigin(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  try {
    const resp = await fetch(req)
    if (resp && resp.status === 200) void put(req, resp)
    return resp
  } catch {
    return Response.error()
  }
}

const EXCLUDED = ['/api/', '/ws', '/health', '/ready']

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  if (req.method !== 'GET') return
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return

  const sameOrigin = url.origin === self.location.origin
  if (sameOrigin && EXCLUDED.some((p) => url.pathname.startsWith(p))) return

  if (req.mode === 'navigate') {
    event.respondWith(navigate(req))
  } else if (sameOrigin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req))
  } else if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(req))
  } else if (url.hostname === 'tile.openstreetmap.org' || url.hostname === 'fonts.googleapis.com') {
    event.respondWith(crossOrigin(req))
  }
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})
