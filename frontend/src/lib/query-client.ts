/**
 * TanStack Query — global QueryClient configuration.
 *
 * Design decisions:
 *  - `staleTime: 5 * 60 * 1000` (5 min) — queries stay fresh for 5 minutes.
 *    Prevents excessive refetching when navigating between views that share
 *    the same data (e.g. brands list shown on homepage + search + booking).
 *  - `gcTime: 30 * 60 * 1000` (30 min) — inactive queries are garbage-collected
 *    after 30 minutes. Keeps recently-used data in cache for instant back-nav.
 *  - `refetchOnWindowFocus: false` — DISABLED. The app uses long-lived tokens
 *    and server-side data changes rarely; refetching on every tab focus causes
 *    unnecessary network traffic and UI flicker.
 *  - `refetchOnMount: 'always'` — when a component mounts, always refetch if
 *    data is stale (even if cached). Ensures fresh data on first view.
 *  - `refetchOnReconnect: true` — refetch when network is restored after
 *    offline (e.g. mobile subway → surface).
 *  - `retry: 1` — retry failed queries once (network blips). More retries
 *    make the UI feel sluggish on persistent errors.
 *  - `retryDelay: 1000` — wait 1s before retrying.
 */

import { QueryClient } from '@tanstack/react-query'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 5 min — data is considered fresh; no refetch on mount/focus.
        staleTime: 5 * 60 * 1000,
        // 30 min — inactive queries are GC'd after this.
        gcTime: 30 * 60 * 1000,
        // DISABLED: no refetch when user refocuses the tab/window.
        // This is the single most important setting for UX — prevents
        // the "page reloads when I alt-tab back" problem.
        refetchOnWindowFocus: false,
        // Refetch when component mounts AND data is stale.
        refetchOnMount: 'always',
        // Refetch when network is restored after offline.
        refetchOnReconnect: true,
        // Retry up to 3 times on failure. 429 (rate-limit) responses get
        // exponential backoff so we don't hammer the server; other errors
        // retry once with a 1s delay.
        retry: (failureCount, error) => {
          const status = (error as { status?: number })?.status
          if (status === 429) return failureCount < 3
          return failureCount < 1
        },
        retryDelay: (attempt, error) => {
          const status = (error as { status?: number })?.status
          if (status === 429) return Math.min(1000 * 2 ** attempt, 10_000)
          return 1000
        },
      },
      mutations: {
        // Mutations don't retry by default — if a booking fails, show the
        // error immediately so the user can act on it.
        retry: 0,
      },
    },
  })
}

// Standard query key factory — keeps keys consistent across the app.
// Usage: queryKey: queryKeys.brands
export const queryKeys = {
  brands: ['brands'] as const,
  brand: (slug: string) => ['brands', slug] as const,
  routes: ['routes'] as const,
  route: (slug: string) => ['routes', slug] as const,
  trips: {
    all: ['trips'] as const,
    search: (params: Record<string, any>) => ['trips', 'search', params] as const,
    detail: (id: string) => ['trips', 'detail', id] as const,
    seats: (tripSessionId: string) => ['trips', 'seats', tripSessionId] as const,
  },
  places: {
    all: ['places'] as const,
    search: (q: string) => ['places', 'search', q] as const,
    searchFts: (q: string) => ['places', 'search-fts', q] as const,
    reverse: (lat: number, lon: number) => ['places', 'reverse', lat, lon] as const,
  },
  campaigns: ['campaigns'] as const,
  reviews: {
    all: ['reviews'] as const,
    byRoute: (routeId: string) => ['reviews', 'route', routeId] as const,
    byBrand: (brandId: string) => ['reviews', 'brand', brandId] as const,
  },
  bookings: {
    all: ['bookings'] as const,
    detail: (code: string) => ['bookings', code] as const,
  },
  notifications: ['notifications'] as const,
  wishlist: ['wishlist'] as const,
  priceAlerts: ['price-alerts'] as const,
  recommendations: ['recommendations'] as const,
  stats: (range: string) => ['stats', range] as const,
  user: {
    me: ['user', 'me'] as const,
  },
}
