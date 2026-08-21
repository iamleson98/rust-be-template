/**
 * Centralized TanStack Query hooks for the VeXeVN frontend.
 *
 * This module wraps the auto-generated OpenAPI SDK (`@/lib/api/sdk.gen`)
 * + TanStack Query options (`@/lib/api/@tanstack/react-query.gen`) into
 * ergonomic hooks. Components import from here — they never call the
 * raw SDK or `fetch()` directly.
 *
 * ## Pattern
 * - **Reads** use `useQuery` + the generated `xxxOptions()` helper.
 * - **Writes** use `useMutation` + the generated SDK function, with
 *   `onSuccess` cache invalidation.
 * - **Types** are re-exported from `@/lib/api/types.gen` so components
 *   don't need a separate `queries/types.ts`.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'

// NOTE: No bare SDK imports — all hooks use generated TanStack
// Options/Mutation helpers from @tanstack/react-query.gen.

// Generated TanStack Query options + keys + mutations
import {
  // auth
  meOptions,
  meQueryKey,
  logoutMutation,
  loginMutation,
  registerMutation,
  employeeLoginMutation,
  // brands
  brandsOptions,
  brandDetailOptions,
  // routes
  routesOptions,
  // trips
  searchTripsOptions,
  tripDetailOptions,
  recommendationsOptions,
  // campaigns
  campaignsOptions,
  validateCampaignOptions,
  validateCampaignQueryKey,
  // places (list10 = /api/places, search = /api/places/search)
  searchOptions as placeSearchOptions,
  list10Options as placeListOptions,
  list10QueryKey as placeListQueryKey,
  // reviews (list12 = /api/reviews, tags = /api/reviews/tags)
  list12Options as reviewsListOptions,
  list12QueryKey as reviewsListQueryKey,
  tagsOptions as reviewTagsOptions,
  get2Options as reviewGetOptions,
  update5Mutation as reviewUpdateMutation,
  remove2Mutation as reviewDeleteMutation,
  create6Mutation as reviewCreateMutation,
  // bookings
  listOptions as bookingsListOptions,
  detailOptions as bookingDetailOptions,
  lookupOptions as bookingLookupOptions,
  holdMutation,
  confirmMutation,
  cancelMutation,
  // price alerts (list11 = /api/price-alerts, create5 = POST /api/price-alerts)
  list11Options as priceAlertsListOptions,
  list11QueryKey as priceAlertsListQueryKey,
  create5Mutation as priceAlertCreateMutation,
  removeMutation as priceAlertRemoveMutation,
  // notifications
  list9Options as notificationsListOptions,
  list9QueryKey as notificationsListQueryKey,
  markRead2Mutation as notificationsMarkReadMutation,
  // wishlist (list13 = /api/wishlist)
  list13Options as wishlistListOptions,
  list13QueryKey as wishlistListQueryKey,
  toggleMutation as wishlistToggleMutation,
  remove3Mutation as wishlistRemoveMutation,
  // stats (stats2 = /api/stats — public, stats = /api/admin/bookings/stats)
  stats2Options,
  // admin — brands
  list2Options as adminBrandsListOptions,
  list2QueryKey as adminBrandsListQueryKey,
  createMutation as createBrandMutation,
  deleteMutation as deleteBrandMutation,
  updateMutation as updateBrandMutation,
  // admin — routes
  list6Options as adminRoutesListOptions,
  list6QueryKey as adminRoutesListQueryKey,
  create3Mutation as createRouteMutation,
  delete4Mutation as deleteRouteMutation,
  update3Mutation as updateRouteMutation,
  // admin — schedules
  list7Options as adminSchedulesListOptions,
  create4Mutation as createScheduleMutation,
  delete5Mutation as deleteScheduleMutation,
  update4Mutation as updateScheduleMutation,
  // admin — pickup points
  list4Options as adminPickupPointsListOptions,
  create2Mutation as createPickupPointMutation,
  delete2Mutation as deletePickupPointMutation,
  // admin — bus layouts
  list3Options as adminBusLayoutsListOptions,
  // admin — reviews
  list5Options as adminReviewsListOptions,
  list5QueryKey as adminReviewsListQueryKey,
  moderateMutation,
  // admin — bookings
  listOptions as adminBookingsListOptions,
  getOptions as adminGetBookingOptions,
  statsOptions as adminBookingStatsOptions,
  exportOptions as adminBookingExportOptions,
  exportQueryKey as adminBookingExportQueryKey,
  updateStatusMutation,
  // chat
  listChannelsOptions as chatChannelsListOptions,
  listChannelsQueryKey as chatChannelsListQueryKey,
  listMessagesOptions as chatMessagesListOptions,
  listMessagesQueryKey as chatMessagesListQueryKey,
  postMessageMutation as chatPostMessageMutation,
  createChannelMutation as chatCreateChannelMutation,
  markReadMutation as chatMarkReadMutation,
} from '@/lib/api/@tanstack/react-query.gen'

// Generated types — re-exported so components can import from here
import type {
  AuthResponse,
  BookingCancelResponse,
  BookingConfirmResponse,
  BookingHoldResponse,
  BookingListItem,
  BookingListResponse,
  BookingLookupResponse,
  BrandDetailOut,
  BrandListResponse,
  BrandOut,
  CampaignListResponse,
  CampaignOut,
  CampaignValidateResponse,
  ChatChannelOut,
  ChatMessageOut,
  CreateChannelResponse,
  CreateMessageResponse,
  CreateReviewInput,
  HoldReq,
  NotificationListResponse,
  NotificationOut,
  PlaceListResponse,
  PlaceOut,
  PlaceSearchHit,
  PlaceSearchResponse,
  PriceAlertListEnvelope,
  PriceAlertOut,
  ReviewListResponse,
  ReviewOut,
  ReviewTagsResponse,
  RouteListResponse,
  RouteOut,
  SessionUser,
  StatsResponse,
  ToggleWishlistResponse,
  TripDetail,
  TripResult,
  TripSearchResponse,
  WishlistItemOut,
  WishlistListResponse,
  AdminBrandListResponse,
  AdminBrandOut,
  AdminBookingDetailResponse,
  AdminBookingExportResponse,
  AdminBookingListResponse,
  AdminBookingOut,
  AdminBookingSeatOut,
  AdminBookingStatsResponse,
  AdminBusLayoutListResponse,
  AdminBusLayoutOut,
  AdminMutationResponse,
  AdminPickupPointListResponse,
  AdminPickupPointOut,
  AdminReviewListResponse,
  AdminRouteListResponse,
  AdminRouteOut,
  AdminScheduleListResponse,
  AdminScheduleOut,
} from '@/lib/api/types.gen'

// ─────────────────────────────────────────────────────────────
// Type re-exports (components import types from here, not from
// queries/types.ts which is deleted)
// ─────────────────────────────────────────────────────────────

export type {
  BrandOut as Brand,
  RouteOut as RouteItem,
  CampaignOut as Campaign,
  TripResult,
  TripDetail,
  PlaceOut,
  PlaceSearchHit,
  ReviewOut as ReviewItem,
  NotificationOut as NotificationItem,
  WishlistItemOut as WishlistItem,
  PriceAlertOut as PriceAlert,
  AdminBrandOut as AdminBrand,
  AdminRouteOut as AdminRoute,
  AdminScheduleOut as AdminSchedule,
  AdminPickupPointOut as AdminPickupPoint,
  AdminReviewListResponse,
  AdminBookingOut,
  AdminBookingOut as AdminBookingItem,
  AdminBookingListResponse,
  AdminBookingStatsResponse,
  AdminBookingStatsResponse as AdminBookingStats,
  AdminBookingExportResponse,
  AdminMutationResponse,
}

// Convenience types used by components
export type ListEnvelope<T> = { items: T[]; total?: number | null; unread?: number }

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

export type RecommendationItem = TripResult

// Admin booking filter shape (used by the tickets panel)
export type AdminBookingFilter = {
  brandId?: string
  routeId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  range?: string
  search?: string
  limit?: number | null
  offset?: number | null
  sort?: string
}

// ─────────────────────────────────────────────────────────────
// Brands
// ─────────────────────────────────────────────────────────────

export function useBrands() {
  return useQuery({
    ...brandsOptions(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useBrand(slug: string | undefined) {
  return useQuery({
    ...brandDetailOptions({ path: { slug: slug! } }),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────

export function usePopularRoutes() {
  return useQuery({
    ...routesOptions(),
    staleTime: 10 * 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Trips — search + detail + recommendations
// ─────────────────────────────────────────────────────────────

/** Build the typed query params the generated SDK expects. */
function tripSearchQuery(params: TripSearchParams) {
  const minSeats = (params.adults ?? 1) + (params.children ?? 0)
  return {
    from: params.from,
    to: params.to,
    date: params.date,
    sort: params.sort ?? 'departure',
    minSeats,
    vehicleTypes: params.vehicleTypes && params.vehicleTypes.length
      ? params.vehicleTypes.join(',')
      : undefined,
  }
}

export function useTripSearch(params: TripSearchParams | null) {
  // Always build a query object so the generated options' queryKey stays
  // well-typed (the SDK keys cache by the query params, so the same
  // from/to/date share the same cache entry regardless of where the hook
  // is mounted). When `params` is null we pass empty placeholders and
  // disable the query via `enabled` so no request fires.
  const query = tripSearchQuery(params ?? { from: '', to: '', date: '' })
  return useQuery({
    ...searchTripsOptions({ query }),
    enabled: !!params && (!!params.from || !!params.to) && !!params.date,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
    retry: 1,
  })
}

export function useTripDetail(tripId: string | undefined) {
  return useQuery({
    ...tripDetailOptions({ path: { id: tripId! } }),
    enabled: !!tripId,
    staleTime: 2 * 60 * 1000,
  })
}

export function useRecommendations() {
  return useQuery({
    ...recommendationsOptions(),
    staleTime: 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Campaigns
// ─────────────────────────────────────────────────────────────

export function useCampaigns() {
  return useQuery({
    ...campaignsOptions(),
    staleTime: 5 * 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Places — autocomplete + reverse geocode
// ─────────────────────────────────────────────────────────────

export function usePlaceSearch(q: string, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? q.trim().length >= 1
  return useQuery({
    ...placeSearchOptions({ query: { q, limit: 15 } }),
    enabled,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function usePlacesList(limit = 50) {
  return useQuery({
    ...placeListOptions({ query: { limit: limit ?? null } }),
    staleTime: 5 * 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────

export function useReviewsByRoute(routeId: string | undefined) {
  return useQuery({
    ...reviewsListOptions({ query: { route_id: routeId, limit: 20 } }),
    enabled: !!routeId,
    staleTime: 60 * 1000,
  })
}

export function useReviewsByBrand(brandId: string | undefined) {
  return useQuery({
    ...reviewsListOptions({ query: { brand_id: brandId, limit: 20 } }),
    enabled: !!brandId,
    staleTime: 60 * 1000,
  })
}

export function useMyReviews(opts?: { enabled?: boolean; userId?: string | null }) {
  const userId = opts?.userId ?? null
  return useQuery({
    ...reviewsListOptions({ query: { user_id: userId ?? undefined, limit: 50 } }),
    enabled: (opts?.enabled ?? false) && !!userId,
  })
}

export function useReviewTags() {
  return useQuery({
    ...reviewTagsOptions(),
    staleTime: 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Bookings
// ─────────────────────────────────────────────────────────────

export function useMyBookings(status?: string) {
  return useQuery({
    ...bookingsListOptions({ query: { status: status ?? 'all' } }),
    staleTime: 30 * 1000,
  })
}

export function useBooking(code: string | undefined) {
  return useQuery({
    ...bookingDetailOptions({ path: { id: code! } }),
    enabled: !!code,
    staleTime: 30 * 1000,
  })
}

export function useGuestBookings(phone: string | undefined, code?: string) {
  return useQuery({
    ...bookingLookupOptions({ query: { phone: phone ?? undefined, code: code ?? undefined } }),
    enabled: !!phone || !!code,
    staleTime: 30 * 1000,
  })
}

/**
 * Generic callback overrides for a mutation hook.
 *
 * Callbacks defined here are MERGED with the built-in cache invalidation
 * behaviour: the hook runs its own `onSuccess` (cache invalidation) first,
 * then the caller-supplied callback.
 *
 * Components should pass these at HOOK CREATION time, never at `mutate()`
 * call time — `mutate()` only receives the variables.
 */
type MutationCallbacks<TData, TVars> = {
  onSuccess?: (data: TData, vars: TVars) => void
  onError?: (err: unknown, vars: TVars) => void
  onSettled?: (data: TData | undefined, err: unknown | null, vars: TVars) => void
}

// ─────────────────────────────────────────────────────────────
// Bookings — hold / confirm / cancel
// ─────────────────────────────────────────────────────────────

export function useCancelBooking<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(cancelMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

export function useHoldBooking<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(holdMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

export function useConfirmBooking<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(confirmMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

// ─────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────

export function useNotifications(limit = 20, opts?: { enabled?: boolean }) {
  return useQuery({
    ...notificationsListOptions({ query: { limit } }),
    queryKey: [...notificationsListQueryKey({ query: { limit } })],
    enabled: opts?.enabled ?? true,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    ...notificationsMarkReadMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsListQueryKey() }),
  })
}

// ─────────────────────────────────────────────────────────────
// Wishlist
// ─────────────────────────────────────────────────────────────

export function useWishlist(opts?: { enabled?: boolean }) {
  return useQuery({
    ...wishlistListOptions(),
    queryKey: [...wishlistListQueryKey()],
    enabled: opts?.enabled ?? true,
    staleTime: 60 * 1000,
  })
}

export function useToggleWishlist() {
  const qc = useQueryClient()
  return useMutation({
    ...wishlistToggleMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: wishlistListQueryKey() }),
  })
}

export function useRemoveWishlist() {
  const qc = useQueryClient()
  return useMutation({
    ...wishlistRemoveMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: wishlistListQueryKey() }),
  })
}

// ─────────────────────────────────────────────────────────────
// Price alerts  (generated TanStack client — @hey-api/openapi-ts)
// ─────────────────────────────────────────────────────────────

export function usePriceAlerts(phone?: string | null) {
  const opts = priceAlertsListOptions({ query: { phone: phone ?? undefined } })
  return useQuery({
    queryKey: opts.queryKey,
    queryFn: opts.queryFn as any,
    staleTime: 60 * 1000,
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

export function useCreatePriceAlert() {
  const qc = useQueryClient()
  return useMutation({
    ...priceAlertCreateMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: priceAlertsListQueryKey() })
      qc.invalidateQueries({ queryKey: ['price-alerts'] })
    },
  })
}

export function useRemovePriceAlert() {
  const qc = useQueryClient()
  return useMutation({
    ...priceAlertRemoveMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: priceAlertsListQueryKey() })
      qc.invalidateQueries({ queryKey: ['price-alerts'] })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Auth  (generated TanStack client)
// ─────────────────────────────────────────────────────────────

export function useAuthMe() {
  return useQuery({
    ...meOptions(),
    retry: false,
    staleTime: 5 * 60 * 1000,
    select: (data) => (data ? { user: data.user as unknown as SessionUser } : null),
  })
}

export function useLogout<TData = unknown>(opts?: MutationCallbacks<TData, void>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, void>({
    ...(logoutMutation() as any),
    onSuccess: (data, vars) => {
      qc.clear()
      qc.removeQueries({ queryKey: meQueryKey() })
      opts?.onSuccess?.(data as TData, vars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars),
  })
}

export function useLogin<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(loginMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: meQueryKey() })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

export function useRegister<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(registerMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: meQueryKey() })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

export function useEmployeeLogin<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(employeeLoginMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: meQueryKey() })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

// ─────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────

export function useStats() {
  return useQuery({
    ...stats2Options(),
    staleTime: 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Chat (TanStack hooks for REST endpoints)
// ─────────────────────────────────────────────────────────────

export function useChatChannels(limit = 50) {
  return useQuery({
    ...chatChannelsListOptions({ query: { limit } }),
    staleTime: 30 * 1000,
    // No polling — the admin chat workspace subscribes to the WS
    // hub for realtime updates. Polling is wasteful now that WS
    // delivers new channels + unread-counter changes immediately.
  })
}

export function useChatMessages(channelId: string | undefined, limit = 50) {
  const opts = channelId ? chatMessagesListOptions({ path: { id: channelId }, query: { limit } }) : null
  return useQuery<any>({
    queryKey: opts?.queryKey ?? ['chat', 'messages', 'disabled'],
    queryFn: opts?.queryFn as any ?? (() => Promise.resolve(null)),
    enabled: !!channelId,
    staleTime: 10 * 1000,
    // No polling — the admin chat workspace subscribes to the WS
    // hub for realtime new messages. Polling would just add load
    // without improving UX (WS already gives instant updates).
  })
}

export function usePostChatMessage<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(chatPostMessageMutation() as any),
    onSuccess: (data, vars) => {
      // Use partial key match to invalidate all listMessages + listChannels
      // queries (the generated keys are object arrays, not string arrays).
      qc.invalidateQueries({ queryKey: [{ _id: 'listMessages' }] })
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

/**
 * Create a chat channel (or return the existing open one — the
 * backend enforces 1 open channel per user). Invalidates the
 * channels list so the new/existing channel appears immediately.
 */
export function useCreateChatChannel<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(chatCreateChannelMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

/**
 * Mark a chat channel as read by the current user. Invalidates the
 * channels list so the unread badge clears immediately.
 */
export function useMarkChatRead<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(chatMarkReadMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

// ─────────────────────────────────────────────────────────────
// Campaign validation (for booking dialog)
// ─────────────────────────────────────────────────────────────

export function useValidateCampaign<TData = unknown>(opts?: MutationCallbacks<TData, { code: string; subtotal: number }>) {
  return useMutation<TData, unknown, { code: string; subtotal: number }>({
    mutationFn: async (params: { code: string; subtotal: number }) => {
      const o = validateCampaignOptions({ query: params })
      const queryFn = o.queryFn
      if (!queryFn) throw new Error('queryFn missing')
      return queryFn({ queryKey: o.queryKey as any, signal: new AbortController().signal } as any) as Promise<TData>
    },
    onSuccess: (data, vars) => opts?.onSuccess?.(data, vars),
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data, err, vars),
  })
}

// ─────────────────────────────────────────────────────────────
// Review creation (for review dialog)
// ─────────────────────────────────────────────────────────────

export function useCreateReview<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(reviewCreateMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: reviewsListQueryKey() })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

export function useUpdateReview<TData = unknown, TVars = unknown>(opts?: MutationCallbacks<TData, TVars>) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    ...(reviewUpdateMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: reviewsListQueryKey() })
      opts?.onSuccess?.(data as TData, vars as TVars)
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Brands
// ─────────────────────────────────────────────────────────────

export function useAdminBrands() {
  return useQuery({
    ...adminBrandsListOptions(),
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminBrand() {
  const qc = useQueryClient()
  return useMutation({
    ...createBrandMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminBrandsListQueryKey() })
      qc.invalidateQueries({ queryKey: ['brands'] })
    },
  })
}

export function useDeleteAdminBrand() {
  const qc = useQueryClient()
  return useMutation({
    ...deleteBrandMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminBrandsListQueryKey() })
      qc.invalidateQueries({ queryKey: ['brands'] })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Routes
// ─────────────────────────────────────────────────────────────

export function useAdminRoutes(brandId?: string) {
  return useQuery({
    ...adminRoutesListOptions({ query: { brandId } }),
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminRoute() {
  const qc = useQueryClient()
  return useMutation({
    ...createRouteMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminRoutesListQueryKey() })
      qc.invalidateQueries({ queryKey: ['routes'] })
    },
  })
}

export function useDeleteAdminRoute() {
  const qc = useQueryClient()
  return useMutation({
    ...deleteRouteMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminRoutesListQueryKey() })
      qc.invalidateQueries({ queryKey: ['routes'] })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Schedules
// ─────────────────────────────────────────────────────────────

export function useAdminSchedules(routeId?: string) {
  return useQuery({
    ...adminSchedulesListOptions({ query: { routeId } }),
    enabled: !!routeId,
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminSchedule() {
  const qc = useQueryClient()
  return useMutation({
    ...createScheduleMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'schedules'] }),
  })
}

export function useDeleteAdminSchedule() {
  const qc = useQueryClient()
  return useMutation({
    ...deleteScheduleMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'schedules'] }),
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Pickup points
// ─────────────────────────────────────────────────────────────

export function useAdminPickupPoints(routeId?: string) {
  return useQuery({
    ...adminPickupPointsListOptions({ query: { routeId } }),
    enabled: !!routeId,
    staleTime: 30 * 1000,
  })
}

export function useUpsertAdminPickupPoint() {
  const qc = useQueryClient()
  return useMutation({
    ...createPickupPointMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pickup-points'] }),
  })
}

export function useDeleteAdminPickupPoint() {
  const qc = useQueryClient()
  return useMutation({
    ...deletePickupPointMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pickup-points'] }),
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Reviews moderation
// ─────────────────────────────────────────────────────────────

export function useAdminReviews(opts?: { status?: string; brandId?: string; search?: string }) {
  const status = opts?.status ?? ''
  const brandId = opts?.brandId ?? ''
  const search = (opts?.search ?? '').trim()
  return useQuery({
    ...adminReviewsListOptions({
      query: {
        status: status || undefined,
        brandId: brandId || undefined,
        search: search || undefined,
        limit: 50,
      },
    }),
    staleTime: 30 * 1000,
  })
}

export function useModerateAdminReview() {
  const qc = useQueryClient()
  return useMutation({
    ...moderateMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminReviewsListQueryKey() })
      qc.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Bus layouts
// ─────────────────────────────────────────────────────────────

export function useAdminBusLayouts(brandId?: string) {
  return useQuery({
    ...adminBusLayoutsListOptions({ query: { brandId } }),
    staleTime: 30 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────
// Admin — Bookings
// ─────────────────────────────────────────────────────────────

export function useAdminBookings(filter: AdminBookingFilter) {
  return useQuery({
    ...adminBookingsListOptions({
      query: {
        brandId: filter.brandId,
        routeId: filter.routeId,
        status: filter.status && filter.status !== 'all' ? filter.status : undefined,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        search: filter.search,
        limit: filter.limit ?? 50,
        offset: filter.offset ?? 0,
        sort: filter.sort,
      },
    }),
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
    retry: 1,
  })
}

export function useAdminBookingDetail(id: string | undefined) {
  return useQuery({
    ...adminGetBookingOptions({ path: { id: id! } }),
    enabled: !!id,
    staleTime: 15 * 1000,
  })
}

export function useAdminBookingStats(filter: AdminBookingFilter) {
  return useQuery({
    ...adminBookingStatsOptions({
      query: {
        brandId: filter.brandId,
        routeId: filter.routeId,
        status: filter.status && filter.status !== 'all' ? filter.status : undefined,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        search: filter.search,
        limit: filter.limit ?? 50,
        offset: filter.offset ?? 0,
        sort: filter.sort,
      },
    }),
    staleTime: 30 * 1000,
  })
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient()
  return useMutation({
    ...updateStatusMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
    },
  })
}

export function useAdminCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    ...holdMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
    },
  })
}

export function useAdminBookingExport(filter: AdminBookingFilter) {
  const query: Record<string, string | number | undefined> = {
    brandId: filter.brandId,
    routeId: filter.routeId,
    status: filter.status && filter.status !== 'all' ? filter.status : undefined,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    search: filter.search,
    limit: filter.limit ?? 50,
    offset: filter.offset ?? 0,
    sort: filter.sort,
  }
  // Remove undefined values
  Object.keys(query).forEach((k) => query[k] === undefined && delete query[k])
  return useQuery({
    ...adminBookingExportOptions({ query } as any),
    enabled: false, // only fetch on demand via refetch
  })
}
