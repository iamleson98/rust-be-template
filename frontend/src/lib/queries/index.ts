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
  SessionUser,
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

export function usePopularRoutes() {
  return useQuery<ListEnvelope<RouteItem>>({
    queryKey: queryKeys.routes,
    queryFn: () => apiJson('/api/routes'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useRoute(slug: string | undefined) {
  return useQuery<RouteItem>({
    queryKey: slug ? queryKeys.route(slug) : ['routes', 'detail', null],
    queryFn: () => apiJson(`/api/routes/${slug}`),
    enabled: !!slug,
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

/** Build the query string the backend expects. */
function tripSearchQuery(params: TripSearchParams): string {
  const sp = new URLSearchParams()
  if (params.from) sp.set('from', params.from)
  if (params.to) sp.set('to', params.to)
  if (params.date) sp.set('date', params.date)
  sp.set('adults', String(params.adults ?? 1))
  sp.set('children', String(params.children ?? 0))
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

export function useRecommendations(opts?: { phone?: string | null; recentRouteIds?: string[] }) {
  const params = {
    phone: opts?.phone ?? '',
    recent: opts?.recentRouteIds?.slice(0, 8).join(',') ?? '',
  }
  return useQuery<ListEnvelope<RecommendationItem>>({
    queryKey: queryKeys.recommendations,
    queryFn: () => {
      const qs = new URLSearchParams()
      if (params.phone) qs.set('phone', params.phone)
      if (params.recent) qs.set('recent', params.recent)
      return apiJson(`/api/recommendations?${qs.toString()}`)
    },
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
  return useQuery<ListEnvelope<Place>>({
    queryKey: queryKeys.places.search(q),
    queryFn: () => apiJson(`/api/places?q=${encodeURIComponent(q.trim())}&limit=8`),
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

export function useMyReviews(opts?: { enabled?: boolean }) {
  return useQuery<ListEnvelope<ReviewItem>>({
    queryKey: ['reviews', 'mine'],
    queryFn: () => apiJson('/api/reviews?mine=1'),
    // Default to disabled — only fetches when the consumer explicitly
    // opts in (e.g. when the user opens the "Đánh giá của tôi" tab).
    enabled: opts?.enabled ?? false,
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
    mutationFn: async (bookingId: string) => apiJson(`/api/bookings/${bookingId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.bookings.all })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────

export function useNotifications(limit = 20, opts?: { enabled?: boolean }) {
  return useQuery<ListEnvelope<NotificationItem>>({
    queryKey: queryKeys.notifications,
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
      apiJson('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  })
}

// ─────────────────────────────────────────────────────────────
// Wishlist
// ─────────────────────────────────────────────────────────────

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
      apiJson('/api/wishlist', { method: 'POST', body: JSON.stringify(payload) }),
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
// Price alerts
// ─────────────────────────────────────────────────────────────

/**
 * Fetch the authenticated user's price alerts, or — when `phone` is
 * provided — a guest lookup (no auth required). The backend returns
 * `{ items, total?, limit, offset }`.
 */
export function usePriceAlerts(phone?: string | null) {
  return useQuery<ListEnvelope<PriceAlert>>({
    queryKey: phone ? ['price-alerts', 'phone', phone] : queryKeys.priceAlerts,
    queryFn: () => {
      const qs = new URLSearchParams()
      if (phone) qs.set('phone', phone)
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      return apiJson(`/api/price-alerts${suffix}`)
    },
    staleTime: 60 * 1000,
  })
}

/**
 * Create a price alert. Requires authentication (the backend binds
 * the alert to the logged-in user). Sends `targetPrice` as the
 * canonical field; `maxPrice` is forwarded as a legacy alias so older
 * backend versions still accept it.
 */
export function useCreatePriceAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      fromName: string
      toName: string
      maxPrice: number
      phone?: string
      email?: string | null
      targetPrice?: number
      frequency?: 'immediate' | 'daily' | 'weekly'
    }) =>
      apiJson<PriceAlert & { duplicate?: boolean }>('/api/price-alerts', {
        method: 'POST',
        body: JSON.stringify({
          phone: payload.phone,
          email: payload.email ?? null,
          fromName: payload.fromName,
          toName: payload.toName,
          // Send both field names so the backend picks whichever it expects.
          maxPrice: payload.maxPrice,
          targetPrice: payload.targetPrice ?? payload.maxPrice,
          frequency: payload.frequency ?? 'immediate',
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  })
}

/**
 * Cancel (soft-delete) a price alert by id. Requires authentication;
 * the backend checks ownership.
 */
export function useRemovePriceAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      apiJson(`/api/price-alerts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  })
}

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

export function useAuthMe() {
  return useQuery<{ user: SessionUser } | null>({
    queryKey: queryKeys.user.me,
    queryFn: async () => {
      const res = await apiJson<{ user: SessionUser } | null>('/api/auth/me', { method: 'GET' })
      return res
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
    // Don't refetch on focus — auth state is stable; refetching causes flicker.
    refetchOnWindowFocus: false,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => apiJson('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear()
      qc.removeQueries({ queryKey: queryKeys.user.me })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Stats (admin)
// ─────────────────────────────────────────────────────────────

export function useStats(range = '30d') {
  return useQuery({
    queryKey: queryKeys.stats(range),
    queryFn: () => apiJson(`/api/stats?range=${range}`),
    staleTime: 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Brands
// ─────────────────────────────────────────────────────────────

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

export function useAdminRoutes(brandId?: string) {
  return useQuery<ListEnvelope<AdminRoute>>({
    queryKey: ['admin', 'routes', { brandId: brandId ?? '' }],
    queryFn: () => apiJson(brandId ? `/api/admin/routes?brandId=${brandId}` : '/api/admin/routes'),
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

export function useAdminSchedules(routeId?: string) {
  return useQuery<ListEnvelope<AdminSchedule>>({
    queryKey: ['admin', 'schedules', { routeId: routeId ?? '' }],
    queryFn: () => apiJson(routeId ? `/api/admin/schedules?routeId=${routeId}` : '/api/admin/schedules'),
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

export function useAdminPickupPoints(routeId?: string) {
  return useQuery<ListEnvelope<AdminPickupPoint>>({
    queryKey: ['admin', 'pickup-points', { routeId: routeId ?? '' }],
    queryFn: () => apiJson(routeId ? `/api/admin/pickup-points?routeId=${routeId}` : '/api/admin/pickup-points'),
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
        body: JSON.stringify(payload),
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

export function useAdminBusLayouts(brandId?: string) {
  return useQuery<ListEnvelope<AdminBusLayout>>({
    queryKey: ['admin', 'bus-layouts', { brandId: brandId ?? '' }],
    queryFn: () => apiJson(brandId ? `/api/admin/bus-layouts?brandId=${brandId}` : '/api/admin/bus-layouts'),
    staleTime: 30 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Bookings (sold tickets) management
// ─────────────────────────────────────────────────────────────
//
// Backs the new "Vé đã bán" admin tab + the chat-panel ticket picker.
// All hooks hit the Rust endpoints added in `backend-rust/src/routes/admin.rs`:
//   GET    /api/admin/bookings          — list with filters + inline stats
//   POST   /api/admin/bookings          — employee creates booking for user
//   GET    /api/admin/bookings/:id      — admin detail view
//   PATCH  /api/admin/bookings/:id      — update status (confirmed/cancelled/completed)
//   GET    /api/admin/bookings/stats    — aggregate by day + brand
//   GET    /api/admin/bookings/export   — CSV export with filters

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
    }) =>
      apiJson('/api/admin/bookings', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
      qc.invalidateQueries({ queryKey: queryKeys.bookings.all })
    },
  })
}

/**
 * Export the filtered bookings as a CSV string. Returns the server-generated
 * CSV (with UTF-8 BOM for Excel) + the suggested filename. The caller is
 * responsible for triggering the browser download (see `downloadCSV` in
 * `admin-dashboard/helpers.ts`).
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
