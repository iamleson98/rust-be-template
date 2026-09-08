/**
 * Service Worker — VeXeVN PWA.
 *
 * Caching strategy:
 *   - App shell (HTML/CSS/JS): stale-while-revalidate.
 *   - Static assets (images, fonts, icons): cache-first (fingerprinted).
 *   - API responses: NO caching (TanStack Query handles that).
 *   - OSM tiles: cache-first with stale-while-revalidate fallback.
 *
 * Lifecycle:
 *   - install: precache the app shell + offline page.
 *   - activate: clean up old caches.
 *   - fetch: route requests to the right strategy.
 */

const VERSION = 'v1'
const PRECACHE = `datxevui-precache-${VERSION}`
const RUNTIME = `datxevui-runtime-${VERSION}`

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
          keys
            .filter((k) => k !== PRECACHE && k !== RUNTIME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  if (req.method !== 'GET') return
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return

  // Don't intercept API calls, WS, or auth refresh.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/health')
  ) {
    return
  }

  // Navigation requests — network-first, fall back to cache, then offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone()
          caches.open(RUNTIME).then((cache) => cache.put(req, copy))
          return resp
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/offline.html')),
        ),
    )
    return
  }

  // Same-origin static assets — stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const copy = resp.clone()
              caches.open(RUNTIME).then((cache) => cache.put(req, copy))
            }
            return resp
          })
          .catch(() => cached)
        return cached || fetchPromise
      }),
    )
    return
  }

  // Cross-origin (OSM tiles, Google Fonts) — cache-first.
  if (url.hostname === 'tile.openstreetmap.org' || url.hostname === 'fonts.googleapis.com') {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          fetch(req)
            .then((resp) => {
              if (resp && resp.status === 200) {
                const copy = resp.clone()
                caches.open(RUNTIME).then((cache) => cache.put(req, copy))
              }
            })
            .catch(() => {})
          return cached
        }
        return fetch(req)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const copy = resp.clone()
              caches.open(RUNTIME).then((cache) => cache.put(req, copy))
            }
            return resp
          })
          .catch(() => caches.match('/offline.html'))
      }),
    )
  }
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})
