/**
 * Centralized TanStack Query hooks for the VeXeVN frontend.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Before this module, every component fetched data with a bespoke
 * `useEffect + fetch + useState` pattern. That meant:
 *   - No caching → every mount re-fetched, even if the data was seconds old.
 *   - No deduplication → two components fetching the same endpoint made two requests.
 *   - No retry / refetch-on-reconnect → flaky networks silently showed stale empty states.
 *   - Inconsistent error handling → some components swallowed errors, some crashed.
 *
 * This module exposes one typed hook per logical query. Every hook:
 *   - Returns `{ data, isLoading, isPending, isError, error, isFetching, refetch }`
 *     so consumers can render skeletons / error UIs / data uniformly.
 *   - Uses a stable query key (from `queryKeys`) so cache is shared app-wide.
 *   - Throws a typed `ApiError` on non-2xx (via `apiJson`), surfaced as `error`.
 *
 * USAGE
 * ─────
 *   const { data, isLoading, isError, error } = useBrands()
 *   if (isLoading) return <Skeleton />
 *   if (isError) return <ErrorState message={error.message} />
 *   return <BrandList brands={data.items} />
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiJson, type ApiError } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-client'
import {
  // Generated TanStack Query options & keys (from @hey-api/openapi-ts)
  meOptions,
  meQueryKey,
  logoutMutation,
  list3Options as priceAlertsListOptions,
  list3QueryKey as priceAlertsListQueryKey,
} from '@/lib/api/@tanstack/react-query.gen'
import {
  // Generated SDK functions (for direct use in mutations)
  create as sdkCreatePriceAlert,
  remove as sdkRemovePriceAlert,
} from '@/lib/api/sdk.gen'
import type { CreatePriceAlertRequest, SessionUser } from '@/lib/api/types.gen'
import type {
  Brand,
  RouteItem,
  Campaign,
  TripResult,
  TripDetail,
  Place,
  ReviewItem,
  ReviewSummary,
  BookingItem,
  NotificationItem,
  RecommendationItem,
  WishlistItem,
  PriceAlert,
  AdminBrand,
  AdminRoute,
  AdminSchedule,
  AdminPickupPoint,
  AdminReview,
  AdminBusLayout,
  AdminBookingFilter,
  AdminBookingDetail,
  AdminBookingListResponse,
  AdminBookingStatsResponse,
  AdminBookingExportResponse,
  ListEnvelope,
} from './types'

// ─────────────────────────────────────────────────────────────
// Brands
// ─────────────────────────────────────────────────────────────

export function useBrands() {
  return useQuery<ListEnvelope<Brand>>({
    queryKey: queryKeys.brands,
    queryFn: () => apiJson('/api/brands'),
    staleTime: 10 * 60 * 1000, // brands change rarely
  })
}

export function useBrand(slug: string | undefined) {
  return useQuery<Brand>({
    queryKey: slug ? queryKeys.brand(slug) : ['brands', 'detail', null],
    queryFn: () => apiJson(`/api/brands/${slug}`),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────
// Backend route: GET /api/routes?brandId=&limit=
// There is NO `GET /api/routes/{slug}` endpoint — `useRoute` was removed.

export function usePopularRoutes() {
  return useQuery<ListEnvelope<RouteItem>>({
    queryKey: queryKeys.routes,
    queryFn: () => apiJson('/api/routes'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useRoutesByBrand(brandId: string | undefined) {
  return useQuery<ListEnvelope<RouteItem>>({
    queryKey: ['routes', { brandId: brandId ?? '' }],
    queryFn: () =>
      apiJson(brandId ? `/api/routes?brandId=${encodeURIComponent(brandId)}` : '/api/routes'),
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Trips — search + detail + recommendations
// ─────────────────────────────────────────────────────────────

export type TripSearchParams = {
  from: string
  to: string
  date: string
  adults?: number
  children?: number
  sort?: string
  vehicleTypes?: string[]
  roundTrip?: boolean
  returnDate?: string
}

/** Build the query string the backend expects.
 *
 * Backend `GET /api/search` accepts (snake_case):
 *   from, to, date, limit?, vehicle_types? (csv), sort?, min_seats?
 *
 * The frontend collects `adults` + `children`; we sum them into `minSeats`
 * so trips without enough available seats are filtered out server-side.
 */
function tripSearchQuery(params: TripSearchParams): string {
  const sp = new URLSearchParams()
  if (params.from) sp.set('from', params.from)
  if (params.to) sp.set('to', params.to)
  if (params.date) sp.set('date', params.date)
  const minSeats = (params.adults ?? 1) + (params.children ?? 0)
  sp.set('min_seats', String(minSeats))
  sp.set('sort', params.sort ?? 'departure')
  if (params.vehicleTypes && params.vehicleTypes.length) {
    sp.set('vehicle_types', params.vehicleTypes.join(','))
  }
  return sp.toString()
}

export function useTripSearch(params: TripSearchParams | null) {
  return useQuery<ListEnvelope<TripResult>>({
    queryKey: params ? queryKeys.trips.search(params) : ['trips', 'search', null],
    queryFn: () => apiJson(`/api/search?${tripSearchQuery(params!)}`),
    enabled: !!params && (!!params.from || !!params.to) && !!params.date,
    placeholderData: keepPreviousData, // smooth UX when filters change
    staleTime: 30 * 1000, // seat availability drifts; refetch after 30s
    retry: 1,
  })
}

export function useTripDetail(tripId: string | undefined) {
  return useQuery<TripDetail>({
    queryKey: tripId ? queryKeys.trips.detail(tripId) : ['trips', 'detail', null],
    queryFn: () => apiJson(`/api/trips/${tripId}`),
    enabled: !!tripId,
    staleTime: 2 * 60 * 1000,
  })
}

export function useRecommendations(_opts?: { phone?: string | null; recentRouteIds?: string[] }) {
  // Backend `GET /api/recommendations` takes NO query params.
  // The personalization params are accepted in the type signature for
  // backward compat with callers, but are ignored.
  return useQuery<ListEnvelope<RecommendationItem>>({
    queryKey: queryKeys.recommendations,
    queryFn: () => apiJson('/api/recommendations'),
    staleTime: 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Campaigns
// ─────────────────────────────────────────────────────────────

export function useCampaigns() {
  return useQuery<ListEnvelope<Campaign>>({
    queryKey: queryKeys.campaigns,
    queryFn: () => apiJson('/api/campaigns'),
    staleTime: 5 * 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Places — autocomplete + reverse geocode
// ─────────────────────────────────────────────────────────────

export function usePlaceSearch(q: string, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? q.trim().length >= 1
  // Backend route is `GET /api/places/search?q=&limit=&lat=&lon=` —
  // `GET /api/places` is an unfiltered paginated list and ignores `q`.
  return useQuery<ListEnvelope<Place>>({
    queryKey: queryKeys.places.search(q),
    queryFn: () =>
      apiJson(`/api/places/search?q=${encodeURIComponent(q.trim())}&limit=15`),
    enabled,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useReverseGeocode(lat: number | null, lon: number | null) {
  return useQuery<{ name: string; province?: string | null }>({
    queryKey: lat != null && lon != null ? queryKeys.places.reverse(lat, lon) : ['places', 'reverse', null],
    queryFn: () => apiJson(`/api/places/reverse?lat=${lat}&lon=${lon}`),
    enabled: lat != null && lon != null,
    staleTime: Infinity, // geographic lookup never changes
  })
}

// ─────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────

export function useReviewsByRoute(routeId: string | undefined) {
  return useQuery<ListEnvelope<ReviewItem> & { summary?: ReviewSummary }>({
    queryKey: routeId ? queryKeys.reviews.byRoute(routeId) : ['reviews', 'route', null],
    queryFn: () => apiJson(`/api/reviews?routeId=${routeId}&limit=20`),
    enabled: !!routeId,
    staleTime: 60 * 1000,
  })
}

export function useReviewsByBrand(brandId: string | undefined) {
  return useQuery<ListEnvelope<ReviewItem> & { summary?: ReviewSummary }>({
    queryKey: brandId ? queryKeys.reviews.byBrand(brandId) : ['reviews', 'brand', null],
    queryFn: () => apiJson(`/api/reviews?brandId=${brandId}&limit=20`),
    enabled: !!brandId,
    staleTime: 60 * 1000,
  })
}

export function useMyReviews(opts?: { enabled?: boolean; userId?: string | null }) {
  // Backend `GET /api/reviews` filters by `userId=` — there is no `mine=1`
  // flag. The caller must pass the current user's id (from `useAuthMe`).
  const userId = opts?.userId ?? null
  return useQuery<ListEnvelope<ReviewItem>>({
    queryKey: ['reviews', 'mine', { userId: userId ?? '' }],
    queryFn: () => apiJson(`/api/reviews?userId=${encodeURIComponent(userId!)}&limit=50`),
    // Default to disabled — only fetches when the consumer explicitly
    // opts in (e.g. when the user opens the "Đánh giá của tôi" tab).
    enabled: (opts?.enabled ?? false) && !!userId,
  })
}

// ─────────────────────────────────────────────────────────────
// Bookings
// ─────────────────────────────────────────────────────────────

export function useMyBookings(status?: string) {
  return useQuery<ListEnvelope<BookingItem>>({
    queryKey: [queryKeys.bookings.all, { status: status ?? 'all' }],
    queryFn: () => apiJson(`/api/bookings?status=${status ?? 'all'}`),
    staleTime: 30 * 1000,
  })
}

export function useBooking(code: string | undefined) {
  return useQuery<BookingItem>({
    queryKey: code ? queryKeys.bookings.detail(code) : ['bookings', 'detail', null],
    queryFn: () => apiJson(`/api/bookings/${code}`),
    enabled: !!code,
    staleTime: 30 * 1000,
  })
}

export function useGuestBookings(phone: string | undefined, code?: string) {
  return useQuery<ListEnvelope<BookingItem>>({
    queryKey: ['bookings', 'lookup', { phone: phone ?? '', code: code ?? '' }],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (phone) qs.set('phone', phone)
      if (code) qs.set('code', code)
      return apiJson(`/api/bookings/lookup?${qs.toString()}`)
    },
    enabled: !!phone || !!code,
    staleTime: 30 * 1000,
  })
}

export function useCancelBooking() {
  const qc = useQueryClient()
  return useMutation({
    // Backend exposes `POST /api/bookings/{id}/cancel` (with optional
    // `{ reason }` body) — there is no `DELETE /api/bookings/{id}` route.
    mutationFn: async (bookingId: string) =>
      apiJson(`/api/bookings/${bookingId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.bookings.all })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────
// Backend routes: `GET /api/notifications?limit=&offset=`
//                `POST /api/notifications/read` (body: `{ ids: [] }`)
// Both require authentication (httpOnly JWT cookie).

export function useNotifications(limit = 20, opts?: { enabled?: boolean }) {
  return useQuery<ListEnvelope<NotificationItem> & { unreadCount?: number }>({
    queryKey: [...queryKeys.notifications, { limit }],
    queryFn: () => apiJson(`/api/notifications?limit=${limit}`),
    enabled: opts?.enabled ?? true,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // poll every 60s for new notifications
  })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) =>
      apiJson('/api/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  })
}

// ─────────────────────────────────────────────────────────────
// Wishlist
// ─────────────────────────────────────────────────────────────
// Backend routes: `GET /api/wishlist`
//                `POST /api/wishlist` (body: `{ routeId?, tripId?, fromName?, toName? }`)
//                `DELETE /api/wishlist/{id}`
// All require authentication.

export function useWishlist(opts?: { enabled?: boolean }) {
  return useQuery<ListEnvelope<WishlistItem>>({
    queryKey: queryKeys.wishlist,
    queryFn: () => apiJson('/api/wishlist'),
    enabled: opts?.enabled ?? true,
    staleTime: 60 * 1000,
  })
}

export function useToggleWishlist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { tripId?: string; routeId?: string; fromName: string; toName: string }) =>
      apiJson('/api/wishlist', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.wishlist }),
  })
}

export function useRemoveWishlist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiJson(`/api/wishlist/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.wishlist }),
  })
}

// ─────────────────────────────────────────────────────────────
// Price alerts  (generated TanStack client — @hey-api/openapi-ts)
// ─────────────────────────────────────────────────────────────

/**
 * Fetch the authenticated user's price alerts, or — when `phone` is
 * provided — a guest lookup (no auth required).
 *
 * Uses the generated `listOptions` from `@tanstack/react-query.gen.ts`
 * which wraps `GET /api/price-alerts` with full type safety.
 * The response is mapped to `ListEnvelope<PriceAlert>` for backward compat.
 */
export function usePriceAlerts(phone?: string | null) {
  const opts = priceAlertsListOptions({ query: { phone: phone ?? undefined } })
  return useQuery<ListEnvelope<PriceAlert>>({
    queryKey: opts.queryKey,
    queryFn: opts.queryFn as any,
    staleTime: 60 * 1000,
    // Map generated PriceAlertOut → local PriceAlert for backward compat
    select: (data: any) => ({
      items: (data?.items ?? []).map((a: any) => ({
        ...a,
        targetPrice: a.targetPrice ?? 0,
        maxPrice: a.targetPrice ?? 0,
        status: a.status ?? 'active',
      })),
      total: data?.total ?? null,
      limit: data?.limit ?? 200,
      offset: data?.offset ?? 0,
    }),
  })
}

/**
 * Create a price alert. Requires authentication (the backend binds
 * the alert to the logged-in user). Sends `targetPrice` as the
 * canonical field; `maxPrice` is forwarded as a legacy alias so older
 * backend versions still accept it.
 *
 * Uses the generated `sdkCreatePriceAlert` from `sdk.gen.ts`.
 * Accepts a flat payload (matching the old API) and wraps it into the
 * generated `{ body }` shape that the SDK expects.
 */
export function useCreatePriceAlert() {
  const qc = useQueryClient()
  return useMutation<PriceAlert & { duplicate?: boolean }, Error, {
    fromName: string
    toName: string
    maxPrice: number
    phone?: string
    email?: string | null
    targetPrice?: number
    frequency?: 'immediate' | 'daily' | 'weekly'
  }>({
    mutationFn: async (payload) => {
      const body: CreatePriceAlertRequest = {
        phone: payload.phone ?? '',
        email: payload.email ?? null,
        fromName: payload.fromName,
        toName: payload.toName,
        targetPrice: payload.targetPrice ?? payload.maxPrice,
        frequency: payload.frequency ?? 'immediate',
      }
      const { data } = await sdkCreatePriceAlert({ body, throwOnError: true })
      return data as PriceAlert & { duplicate?: boolean }
    },
    onSuccess: () => {
      // Invalidate all price-alert queries (both auth and guest lookups)
      qc.invalidateQueries({ queryKey: priceAlertsListQueryKey() })
      qc.invalidateQueries({ queryKey: ['price-alerts'] })
    },
  })
}

/**
 * Cancel (soft-delete) a price alert by id. Requires authentication;
 * the backend checks ownership.
 *
 * Uses the generated `sdkRemovePriceAlert` from `sdk.gen.ts`.
 * Accepts a plain `id` string (matching the old API).
 */
export function useRemovePriceAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await sdkRemovePriceAlert({ path: { id }, throwOnError: true })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: priceAlertsListQueryKey() })
      qc.invalidateQueries({ queryKey: ['price-alerts'] })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Auth  (generated TanStack client — @hey-api/openapi-ts)
// ─────────────────────────────────────────────────────────────

/**
 * Return the current authenticated user's info via `GET /api/auth/me`.
 *
 * Uses the generated `meOptions` from `@tanstack/react-query.gen.ts`.
 * The generated response is `AuthResponse` (`{ user, expires_at }`);
 * we `select` just `{ user }` to keep backward compat with consumers
 * that do `data.user`.
 */
export function useAuthMe() {
  return useQuery({
    ...meOptions(),
    retry: false,
    staleTime: 5 * 60 * 1000,
    select: (data) => (data ? { user: data.user as unknown as SessionUser } : null),
  })
}

/**
 * Log out the current user via `POST /api/auth/logout`.
 *
 * Uses the generated `logoutMutation` from `@tanstack/react-query.gen.ts`.
 * Clears the entire query cache on success so stale auth data doesn't linger.
 */
export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    ...logoutMutation(),
    onSuccess: () => {
      qc.clear()
      qc.removeQueries({ queryKey: meQueryKey() })
      qc.removeQueries({ queryKey: queryKeys.user.me })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Stats (public — no admin auth required)
// ─────────────────────────────────────────────────────────────
// Backend route: `GET /api/stats` (no query params — `range` is ignored).

export function useStats(_range = '30d') {
  return useQuery({
    queryKey: queryKeys.stats(_range),
    queryFn: () => apiJson('/api/stats'),
    staleTime: 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Brands
// ─────────────────────────────────────────────────────────────
// Backend routes (all require employee role):
//   GET    /api/admin/brands          — list all brands
//   POST   /api/admin/brands          — create a brand
//   PUT    /api/admin/brands/{id}      — update a brand
//   DELETE /api/admin/brands/{id}      — delete a brand

export function useAdminBrands() {
  return useQuery<ListEnvelope<AdminBrand>>({
    queryKey: ['admin', 'brands'],
    queryFn: () => apiJson('/api/admin/brands'),
    staleTime: 30 * 1000,
  })
}

export function useAdminBrand(id: string | undefined) {
  return useQuery<AdminBrand>({
    queryKey: ['admin', 'brands', id],
    queryFn: () => apiJson(`/api/admin/brands/${id}`),
    enabled: !!id,
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminBrand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<AdminBrand> & { id?: string }) =>
      apiJson(payload.id ? `/api/admin/brands/${payload.id}` : '/api/admin/brands', {
        method: payload.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'brands'] })
      qc.invalidateQueries({ queryKey: queryKeys.brands })
    },
  })
}

export function useDeleteAdminBrand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiJson(`/api/admin/brands/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'brands'] })
      qc.invalidateQueries({ queryKey: queryKeys.brands })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Routes
// ─────────────────────────────────────────────────────────────
// Backend routes:
//   GET    /api/admin/routes           — list all routes (?brandId=)
//   POST   /api/admin/routes           — create a route
//   PUT    /api/admin/routes/{id}      — update a route
//   DELETE /api/admin/routes/{id}      — delete a route

export function useAdminRoutes(brandId?: string) {
  return useQuery<ListEnvelope<AdminRoute>>({
    queryKey: ['admin', 'routes', { brandId: brandId ?? '' }],
    queryFn: () => apiJson(brandId ? `/api/admin/routes?brandId=${encodeURIComponent(brandId)}` : '/api/admin/routes'),
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<AdminRoute> & { id?: string }) =>
      apiJson(payload.id ? `/api/admin/routes/${payload.id}` : '/api/admin/routes', {
        method: payload.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'routes'] })
      qc.invalidateQueries({ queryKey: queryKeys.routes })
    },
  })
}

export function useDeleteAdminRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiJson(`/api/admin/routes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'routes'] })
      qc.invalidateQueries({ queryKey: queryKeys.routes })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Schedules
// ─────────────────────────────────────────────────────────────
// Backend routes:
//   GET    /api/admin/schedules?routeId=   — list schedules for a route
//   POST   /api/admin/schedules            — create a schedule
//   PUT    /api/admin/schedules/{id}        — update a schedule
//   DELETE /api/admin/schedules/{id}        — delete a schedule

export function useAdminSchedules(routeId?: string) {
  return useQuery<ListEnvelope<AdminSchedule>>({
    queryKey: ['admin', 'schedules', { routeId: routeId ?? '' }],
    queryFn: () => {
      if (!routeId) return Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 })
      return apiJson(`/api/admin/schedules?routeId=${encodeURIComponent(routeId)}`)
    },
    enabled: !!routeId,
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<AdminSchedule> & { id?: string }) =>
      apiJson(payload.id ? `/api/admin/schedules/${payload.id}` : '/api/admin/schedules', {
        method: payload.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'schedules'] }),
  })
}

export function useDeleteAdminSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiJson(`/api/admin/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'schedules'] }),
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Pickup points
// ─────────────────────────────────────────────────────────────
// Backend routes:
//   GET    /api/admin/pickup-points?routeId=   — list pickup points for a route
//   POST   /api/admin/pickup-points            — create a pickup point
//   PUT    /api/admin/pickup-points/{id}        — update a pickup point
//   DELETE /api/admin/pickup-points/{id}        — delete a pickup point

export function useAdminPickupPoints(routeId?: string) {
  return useQuery<ListEnvelope<AdminPickupPoint>>({
    queryKey: ['admin', 'pickup-points', { routeId: routeId ?? '' }],
    queryFn: () => {
      if (!routeId) return Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 })
      return apiJson(`/api/admin/pickup-points?routeId=${encodeURIComponent(routeId)}`)
    },
    enabled: !!routeId,
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminPickupPoint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<AdminPickupPoint> & { id?: string }) =>
      apiJson(payload.id ? `/api/admin/pickup-points/${payload.id}` : '/api/admin/pickup-points', {
        method: payload.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pickup-points'] }),
  })
}

export function useDeleteAdminPickupPoint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiJson(`/api/admin/pickup-points/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pickup-points'] }),
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Reviews (moderation)
// ─────────────────────────────────────────────────────────────
// Backend routes:
//   GET    /api/admin/reviews                — list with filters (?status=&brandId=&routeId=&search=)
//   PATCH  /api/admin/reviews/{id}           — moderate (status + brandReply)
//   DELETE /api/admin/reviews/{id}            — admin delete (any review)

export function useAdminReviews(opts?: { status?: string; brandId?: string; search?: string }) {
  const status = opts?.status ?? ''
  const brandId = opts?.brandId ?? ''
  const search = (opts?.search ?? '').trim()
  return useQuery<ListEnvelope<AdminReview> & { stats?: unknown; brands?: unknown[] }>({
    queryKey: ['admin', 'reviews', { status, brandId, search }],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      if (brandId) qs.set('brandId', brandId)
      if (search) qs.set('search', search)
      qs.set('limit', '50')
      const q = qs.toString()
      return apiJson(q ? `/api/admin/reviews?${q}` : '/api/admin/reviews')
    },
    staleTime: 30 * 1000,
  })
}

export function useModerateAdminReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { id: string; status?: string; brandReply?: string | null }) =>
      apiJson(`/api/admin/reviews/${payload.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: payload.status,
          brandReply: payload.brandReply,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'reviews'] })
      qc.invalidateQueries({ queryKey: queryKeys.reviews.all })
    },
  })
}

export function useDeleteAdminReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiJson(`/api/admin/reviews/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'reviews'] })
      qc.invalidateQueries({ queryKey: queryKeys.reviews.all })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Bus layouts
// ─────────────────────────────────────────────────────────────
// Backend route:
//   GET /api/admin/bus-layouts?brandId=  — list all bus layouts

export function useAdminBusLayouts(brandId?: string) {
  return useQuery<ListEnvelope<AdminBusLayout>>({
    queryKey: ['admin', 'bus-layouts', { brandId: brandId ?? '' }],
    queryFn: () => apiJson(brandId ? `/api/admin/bus-layouts?brandId=${encodeURIComponent(brandId)}` : '/api/admin/bus-layouts'),
    staleTime: 30 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Bookings (sold tickets) management
// ─────────────────────────────────────────────────────────────
// Backend routes:
//   GET    /api/admin/bookings              — list with filters
//   GET    /api/admin/bookings/{id}         — admin detail view
//   PATCH  /api/admin/bookings/{id}         — update status
//   GET    /api/admin/bookings/stats        — aggregate by day + status
//   GET    /api/admin/bookings/export       — CSV export with filters

/** Build the query string for the admin bookings list/stats/export endpoints. */
function adminBookingsQs(filter: AdminBookingFilter): string {
  const sp = new URLSearchParams()
  if (filter.brandId) sp.set('brandId', filter.brandId)
  if (filter.routeId) sp.set('routeId', filter.routeId)
  if (filter.status && filter.status !== 'all') sp.set('status', filter.status)
  if (filter.dateFrom) sp.set('dateFrom', filter.dateFrom)
  if (filter.dateTo) sp.set('dateTo', filter.dateTo)
  if (filter.range) sp.set('range', filter.range)
  if (filter.search) sp.set('search', filter.search)
  if (filter.limit != null) sp.set('limit', String(filter.limit))
  else sp.set('limit', '50')
  if (filter.offset != null) sp.set('offset', String(filter.offset))
  if (filter.sort) sp.set('sort', filter.sort)
  return sp.toString()
}

export function useAdminBookings(filter: AdminBookingFilter) {
  const qs = adminBookingsQs(filter)
  return useQuery<AdminBookingListResponse>({
    queryKey: ['admin', 'bookings', filter],
    queryFn: () => apiJson(`/api/admin/bookings?${qs}`),
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
    retry: 1,
  })
}

export function useAdminBookingDetail(id: string | undefined) {
  return useQuery<{ item: AdminBookingDetail }>({
    queryKey: ['admin', 'bookings', 'detail', id],
    queryFn: () => apiJson(`/api/admin/bookings/${id}`),
    enabled: !!id,
    staleTime: 15 * 1000,
  })
}

export function useAdminBookingStats(filter: AdminBookingFilter) {
  const qs = adminBookingsQs(filter)
  return useQuery<AdminBookingStatsResponse>({
    queryKey: ['admin', 'bookings', 'stats', filter],
    queryFn: () => apiJson(`/api/admin/bookings/stats?${qs}`),
    staleTime: 30 * 1000,
  })
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      id: string
      status: 'confirmed' | 'cancelled' | 'completed' | 'pending' | 'refunded'
      reason?: string
      force?: boolean
    }) =>
      apiJson(`/api/admin/bookings/${payload.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: payload.status,
          reason: payload.reason,
          force: payload.force,
        }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
      qc.invalidateQueries({ queryKey: ['admin', 'bookings', 'detail', vars.id] })
      qc.invalidateQueries({ queryKey: queryKeys.bookings.all })
    },
  })
}

export function useAdminCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      tripId: string
      seatIds: string[]
      passengers: { name: string; type: string; age?: number }[]
      boardingPointId: string
      droppingPointId: string
      contactName?: string
      contactPhone?: string
      contactEmail?: string
      userId?: string
      campaignCode?: string
      autoConfirm?: boolean
    }) => {
      // Use the public `POST /api/bookings` endpoint with camelCase body.
      // The backend binds the booking to the *authenticated* user.
      const body = {
        tripId: payload.tripId,
        seatIds: payload.seatIds,
        passengers: payload.passengers.map((p) => ({
          name: p.name,
          type: p.type,
          age: p.age ?? 0,
        })),
        boardingPointId: payload.boardingPointId,
        droppingPointId: payload.droppingPointId,
        contactName: payload.contactName ?? '',
        contactPhone: payload.contactPhone ?? '',
        contactEmail: payload.contactEmail ?? null,
        campaignCode: payload.campaignCode ?? null,
      }
      const res = await apiJson<{ bookingId?: string; id?: string }>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const bookingId = res.bookingId ?? res.id ?? ''
      if (payload.autoConfirm && bookingId) {
        await apiJson(`/api/bookings/${bookingId}/confirm`, {
          method: 'POST',
          body: JSON.stringify({ paymentMethod: 'cash' }),
        })
      }
      return res
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
      qc.invalidateQueries({ queryKey: queryKeys.bookings.all })
    },
  })
}

/**
 * CSV export via `GET /api/admin/bookings/export`. Returns the
 * server-generated CSV (with UTF-8 BOM for Excel) + the suggested filename.
 */
export function useAdminBookingExport() {
  return useMutation({
    mutationFn: async (payload: { filter: AdminBookingFilter; columns?: string[] }) => {
      const qs = adminBookingsQs(payload.filter)
      const colQs = payload.columns?.length ? `&columns=${payload.columns.join(',')}` : ''
      return apiJson<AdminBookingExportResponse>(
        `/api/admin/bookings/export?${qs}${colQs}`,
      )
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────

export type { ApiError }
export * from './types'
