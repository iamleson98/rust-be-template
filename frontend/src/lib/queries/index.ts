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
// Admin — Brands  (repoint to public `/api/brands`)
// ─────────────────────────────────────────────────────────────
// The Rust backend has no `/api/admin/*` namespace. Read hooks repoint
// to the public `/api/brands` endpoint; mutation hooks are no-ops because
// the public endpoint is read-only. (When the backend adds an admin
// namespace, restore the original URLs.)

export function useAdminBrands() {
  return useQuery<ListEnvelope<AdminBrand>>({
    queryKey: ['admin', 'brands'],
    queryFn: () => apiJson('/api/brands'),
    staleTime: 30 * 1000,
  })
}

export function useAdminBrand(id: string | undefined) {
  return useQuery<AdminBrand>({
    queryKey: ['admin', 'brands', id],
    queryFn: () => apiJson(`/api/brands/${id}`),
    enabled: !!id,
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminBrand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (_payload: Partial<AdminBrand> & { id?: string }) => {
      // No admin endpoint on the backend — fail gracefully.
      throw new Error('Admin brand mutations are not supported by the backend (no /api/admin/brands endpoint).')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'brands'] })
      qc.invalidateQueries({ queryKey: queryKeys.brands })
    },
  })
}

export function useDeleteAdminBrand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (_id: string) => {
      throw new Error('Admin brand delete is not supported by the backend.')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'brands'] })
      qc.invalidateQueries({ queryKey: queryKeys.brands })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Routes  (repoint to public `/api/routes`)
// ─────────────────────────────────────────────────────────────

export function useAdminRoutes(brandId?: string) {
  return useQuery<ListEnvelope<AdminRoute>>({
    queryKey: ['admin', 'routes', { brandId: brandId ?? '' }],
    queryFn: () => apiJson(brandId ? `/api/routes?brandId=${encodeURIComponent(brandId)}` : '/api/routes'),
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (_payload: Partial<AdminRoute> & { id?: string }) => {
      throw new Error('Admin route mutations are not supported by the backend.')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'routes'] })
      qc.invalidateQueries({ queryKey: queryKeys.routes })
    },
  })
}

export function useDeleteAdminRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (_id: string) => {
      throw new Error('Admin route delete is not supported by the backend.')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'routes'] })
      qc.invalidateQueries({ queryKey: queryKeys.routes })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Schedules  (NO BACKEND SUPPORT)
// ─────────────────────────────────────────────────────────────
// The Rust backend exposes no schedule list endpoint at all (schedules are
// only reachable via `/api/trips/{id}`). These hooks return empty data.

export function useAdminSchedules(_routeId?: string) {
  return useQuery<ListEnvelope<AdminSchedule>>({
    queryKey: ['admin', 'schedules', { routeId: _routeId ?? '' }],
    queryFn: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    staleTime: Infinity,
  })
}

export function useUpsertAdminSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (_payload: Partial<AdminSchedule> & { id?: string }) => {
      throw new Error('Admin schedule mutations are not supported by the backend.')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'schedules'] }),
  })
}

export function useDeleteAdminSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (_id: string) => {
      throw new Error('Admin schedule delete is not supported by the backend.')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'schedules'] }),
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Pickup points  (NO BACKEND SUPPORT)
// ─────────────────────────────────────────────────────────────
// Pickup points are nested under trips (`/api/trips/{id}` returns them),
// but there's no standalone admin endpoint. Return empty data.

export function useAdminPickupPoints(_routeId?: string) {
  return useQuery<ListEnvelope<AdminPickupPoint>>({
    queryKey: ['admin', 'pickup-points', { routeId: _routeId ?? '' }],
    queryFn: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    staleTime: Infinity,
  })
}

export function useUpsertAdminPickupPoint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (_payload: Partial<AdminPickupPoint> & { id?: string }) => {
      throw new Error('Admin pickup-point mutations are not supported by the backend.')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pickup-points'] }),
  })
}

export function useDeleteAdminPickupPoint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (_id: string) => {
      throw new Error('Admin pickup-point delete is not supported by the backend.')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pickup-points'] }),
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Reviews (moderation)  (repoint to public `/api/reviews`)
// ─────────────────────────────────────────────────────────────
// The public `/api/reviews` endpoint accepts `brandId`, `routeId`, `userId`,
// `status`, `limit`, `offset`. It does NOT accept `search`.

export function useAdminReviews(opts?: { status?: string; brandId?: string; search?: string }) {
  const status = opts?.status ?? ''
  const brandId = opts?.brandId ?? ''
  const _search = (opts?.search ?? '').trim() // not supported by backend
  return useQuery<ListEnvelope<AdminReview> & { stats?: unknown; brands?: unknown[] }>({
    queryKey: ['admin', 'reviews', { status, brandId, search: _search }],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      if (brandId) qs.set('brandId', brandId)
      qs.set('limit', '50')
      const q = qs.toString()
      return apiJson(q ? `/api/reviews?${q}` : '/api/reviews')
    },
    staleTime: 30 * 1000,
  })
}

export function useModerateAdminReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { id: string; status?: string; brandReply?: string | null }) => {
      // The public backend supports `PATCH /api/reviews/{id}` with body
      // `{ rating?, title?, content?, tags?, photos? }` (owner-only).
      // Admin moderation (status change, brand reply) is not exposed.
      throw new Error('Admin review moderation is not supported by the backend (no /api/admin/reviews endpoint).')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'reviews'] })
      qc.invalidateQueries({ queryKey: queryKeys.reviews.all })
    },
  })
}

export function useDeleteAdminReview() {
  const qc = useQueryClient()
  return useMutation({
    // The public `DELETE /api/reviews/{id}` only works for the review's owner.
    mutationFn: async (id: string) => apiJson(`/api/reviews/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'reviews'] })
      qc.invalidateQueries({ queryKey: queryKeys.reviews.all })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Bus layouts  (NO BACKEND SUPPORT)
// ─────────────────────────────────────────────────────────────
// Bus layouts are returned inline by `/api/trips/{id}`. There is no
// standalone bus-layouts endpoint.

export function useAdminBusLayouts(_brandId?: string) {
  return useQuery<ListEnvelope<AdminBusLayout>>({
    queryKey: ['admin', 'bus-layouts', { brandId: _brandId ?? '' }],
    queryFn: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    staleTime: Infinity,
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Bookings (sold tickets) management  (repoint to public endpoints)
// ─────────────────────────────────────────────────────────────
//
// The Rust backend has NO `/api/admin/bookings` namespace. We repoint to
// the public booking endpoints:
//   GET    /api/bookings          — list the authed user's bookings (`?status=&limit=&offset=`)
//   GET    /api/bookings/{id}     — booking detail
//   POST   /api/bookings/{id}/cancel  — cancel a booking (the only status mutation)
//
// The admin stats / export / status-patch / create-on-behalf hooks are
// stubbed to empty / error because the backend exposes no equivalent.

/** Build the query string for the public bookings list endpoint. */
function adminBookingsQs(filter: AdminBookingFilter): string {
  const sp = new URLSearchParams()
  if (filter.status && filter.status !== 'all') sp.set('status', filter.status)
  if (filter.limit != null) sp.set('limit', String(filter.limit))
  else sp.set('limit', '50')
  if (filter.offset != null) sp.set('offset', String(filter.offset))
  return sp.toString()
}

export function useAdminBookings(filter: AdminBookingFilter) {
  const qs = adminBookingsQs(filter)
  return useQuery<AdminBookingListResponse>({
    queryKey: ['admin', 'bookings', filter],
    queryFn: () => apiJson(`/api/bookings?${qs}`),
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
    retry: 1,
  })
}

export function useAdminBookingDetail(id: string | undefined) {
  return useQuery<{ item: AdminBookingDetail }>({
    queryKey: ['admin', 'bookings', 'detail', id],
    queryFn: async () => {
      // Public endpoint returns the booking object directly — wrap it in `{ item }`.
      const data = await apiJson<AdminBookingDetail>(`/api/bookings/${id}`)
      return { item: data }
    },
    enabled: !!id,
    staleTime: 15 * 1000,
  })
}

export function useAdminBookingStats(_filter: AdminBookingFilter) {
  // Backend has no admin stats endpoint — `/api/stats` returns public
  // aggregate stats (not booking-specific). Return empty shape.
  return useQuery<AdminBookingStatsResponse>({
    queryKey: ['admin', 'bookings', 'stats', _filter],
    queryFn: async () => ({
      total: 0,
      byStatus: {},
      byDay: [],
      byBrand: [],
      revenue: 0,
    } as unknown as AdminBookingStatsResponse),
    staleTime: Infinity,
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
    }) => {
      // The only status mutation the backend exposes is `cancel`.
      if (payload.status === 'cancelled') {
        return apiJson(`/api/bookings/${payload.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: payload.reason ?? null }),
        })
      }
      throw new Error(`Backend does not support setting booking status to ${payload.status}. Only 'cancelled' is possible via POST /api/bookings/{id}/cancel.`)
    },
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
      // Repoint to public `POST /api/bookings` — body is `HoldReq` (snake_case).
      // The backend binds the booking to the *authenticated* user (the `userId`
      // field is ignored — admins cannot create bookings on behalf of users).
      const body = {
        trip_id: payload.tripId,
        seat_ids: payload.seatIds,
        passengers: payload.passengers.map((p) => ({
          name: p.name,
          type: p.type,
          age: p.age ?? 0,
        })),
        boarding_point_id: payload.boardingPointId,
        dropping_point_id: payload.droppingPointId,
        contact_name: payload.contactName ?? '',
        contact_phone: payload.contactPhone ?? '',
        contact_email: payload.contactEmail ?? null,
        campaign_code: payload.campaignCode ?? null,
      }
      const res = await apiJson<{ bookingId?: string; id?: string }>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const bookingId = res.bookingId ?? res.id ?? ''
      if (payload.autoConfirm && bookingId) {
        await apiJson(`/api/bookings/${bookingId}/confirm`, {
          method: 'POST',
          body: JSON.stringify({ payment_method: 'cash' }),
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
 * CSV export — the backend has no `/api/admin/bookings/export` endpoint.
 * Returns an empty CSV (just the BOM + header) so the UI's download flow
 * still works without throwing.
 */
export function useAdminBookingExport() {
  return useMutation({
    mutationFn: async (_payload: { filter: AdminBookingFilter; columns?: string[] }) => {
      return {
        csv: '\uFEFFid,code,status,total,createdAt\n',
        filename: 'vexevn_bookings_export.csv',
      } as unknown as AdminBookingExportResponse
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────

export type { ApiError }
export * from './types'
