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

// Generated SDK functions — only used in component-level calls that
// can't be wrapped in a TanStack hook (e.g. inside useEffect for
// chat-widget's WebSocket lifecycle). All query/mutation hooks
// below use the generated Options/Mutation helpers instead.
import {
  // auth — used by chat-widget useEffect (not in a hook)
  me as sdkMe,
  register as sdkRegister,
  // chat — used by chat-widget + admin-dashboard useEffect/callbacks
  listChannels as sdkListChannels,
  listMessages as sdkListMessages,
  createChannel as sdkCreateChannel,
  postMessage as sdkPostMessage,
  markRead as sdkMarkRead,
  // booking — used by booking-dialog onSubmit (sequential hold+confirm)
  hold as sdkHold,
  confirm as sdkConfirm,
  validateCampaign as sdkValidateCampaign,
  // reviews — used by review-dialog onSubmit
  create2 as sdkCreateReview,
  // reviews list — used by reviews-list useQuery (needs custom queryKey)
  list5 as sdkListReviews,
  // places — used by admin brands useQuery
  list3 as sdkListPlaces,
  // booking export — used by admin export useMutation
  bookingExport as sdkBookingExport,
} from '@/lib/api/sdk.gen'

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
  // places
  searchOptions as placeSearchOptions,
  reverseOptions,
  list3Options as placeListOptions,
  list3QueryKey as placeListQueryKey,
  // reviews
  list5Options as reviewsListOptions,
  list5QueryKey as reviewsListQueryKey,
  tagsOptions as reviewTagsOptions,
  getOptions as reviewGetOptions,
  updateMutation as reviewUpdateMutation,
  remove2Mutation as reviewDeleteMutation,
  create2Mutation as reviewCreateMutation,
  // bookings
  listOptions as bookingsListOptions,
  detailOptions as bookingDetailOptions,
  lookupOptions as bookingLookupOptions,
  holdMutation,
  confirmMutation,
  cancelMutation,
  // price alerts (list4 = /api/price-alerts)
  list4Options as priceAlertsListOptions,
  list4QueryKey as priceAlertsListQueryKey,
  createMutation as priceAlertCreateMutation,
  removeMutation as priceAlertRemoveMutation,
  // notifications
  list2Options as notificationsListOptions,
  list2QueryKey as notificationsListQueryKey,
  markRead2Mutation as notificationsMarkReadMutation,
  // wishlist
  list6Options as wishlistListOptions,
  list6QueryKey as wishlistListQueryKey,
  toggleMutation as wishlistToggleMutation,
  remove3Mutation as wishlistRemoveMutation,
  // stats
  statsOptions,
  // admin — brands
  listBrandsOptions as adminBrandsListOptions,
  listBrandsQueryKey as adminBrandsListQueryKey,
  createBrandMutation,
  updateBrandMutation,
  deleteBrandMutation,
  // admin — routes
  listRoutesOptions as adminRoutesListOptions,
  listRoutesQueryKey as adminRoutesListQueryKey,
  createRouteMutation,
  updateRouteMutation,
  deleteRouteMutation,
  // admin — schedules
  listSchedulesOptions as adminSchedulesListOptions,
  createScheduleMutation,
  updateScheduleMutation,
  deleteScheduleMutation,
  // admin — pickup points
  listPickupPointsOptions as adminPickupPointsListOptions,
  createPickupPointMutation,
  updatePickupPointMutation,
  deletePickupPointMutation,
  // admin — bus layouts
  listBusLayoutsOptions as adminBusLayoutsListOptions,
  // admin — reviews
  listReviewsOptions as adminReviewsListOptions,
  listReviewsQueryKey as adminReviewsListQueryKey,
  moderateReviewMutation,
  deleteReviewMutation as adminDeleteReviewMutation,
  // admin — bookings
  listBookingsOptions as adminBookingsListOptions,
  getBookingOptions as adminGetBookingOptions,
  bookingStatsOptions as adminBookingStatsOptions,
  bookingExportOptions as adminBookingExportOptions,
  bookingExportQueryKey as adminBookingExportQueryKey,
  updateBookingStatusMutation,
  // chat
  listChannelsOptions as chatChannelsListOptions,
  listChannelsQueryKey as chatChannelsListQueryKey,
  listMessagesOptions as chatMessagesListOptions,
  listMessagesQueryKey as chatMessagesListQueryKey,
  createChannelMutation as chatCreateChannelMutation,
  postMessageMutation as chatPostMessageMutation,
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
  BookingListItem as BookingItem,
  NotificationOut as NotificationItem,
  WishlistItemOut as WishlistItem,
  PriceAlertOut as PriceAlert,
  AdminBrandOut as AdminBrand,
  AdminRouteOut as AdminRoute,
  AdminScheduleOut as AdminSchedule,
  AdminPickupPointOut as AdminPickupPoint,
  AdminReviewListResponse,
  AdminBusLayoutOut as AdminBusLayout,
  AdminBookingOut,
  AdminBookingOut as AdminBookingItem,
  AdminBookingDetailResponse,
  AdminBookingDetailResponse as AdminBookingDetail,
  AdminBookingListResponse,
  AdminBookingStatsResponse,
  AdminBookingStatsResponse as AdminBookingStats,
  AdminBookingExportResponse,
  AdminBookingSeatOut as AdminBookingSeat,
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

export function useRoutesByBrand(brandId: string | undefined) {
  return useQuery({
    ...routesOptions({ query: { brand_id: brandId } }),
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000,
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

export function useReverseGeocode(lat: number | null, lon: number | null) {
  return useQuery({
    ...reverseOptions({ query: { lat: lat!, lon: lon!, limit: 10 } }),
    enabled: lat != null && lon != null,
    staleTime: Infinity,
  })
}

export function usePlacesList(limit = 50) {
  return useQuery({
    ...placeListOptions({ query: { limit } }),
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

export function useCancelBooking() {
  const qc = useQueryClient()
  return useMutation({
    ...cancelMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  })
}

export function useHoldBooking() {
  const qc = useQueryClient()
  return useMutation({
    ...holdMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  })
}

export function useConfirmBooking() {
  const qc = useQueryClient()
  return useMutation({
    ...confirmMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
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

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    ...logoutMutation(),
    onSuccess: () => {
      qc.clear()
      qc.removeQueries({ queryKey: meQueryKey() })
    },
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    ...loginMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: meQueryKey() }),
  })
}

export function useRegister() {
  const qc = useQueryClient()
  return useMutation({
    ...registerMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: meQueryKey() }),
  })
}

export function useEmployeeLogin() {
  const qc = useQueryClient()
  return useMutation({
    ...employeeLoginMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: meQueryKey() }),
  })
}

// ─────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────

export function useStats() {
  return useQuery({
    ...statsOptions(),
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
  })
}

export function useChatMessages(channelId: string | undefined, limit = 50) {
  return useQuery({
    ...chatMessagesListOptions({ path: { id: channelId! }, query: { limit } }),
    enabled: !!channelId,
    staleTime: 10 * 1000,
  })
}

export function useCreateChatChannel() {
  const qc = useQueryClient()
  return useMutation({
    ...chatCreateChannelMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatChannelsListQueryKey() }),
  })
}

export function usePostChatMessage() {
  const qc = useQueryClient()
  return useMutation({
    ...chatPostMessageMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatMessagesListQueryKey() }),
  })
}

export function useMarkChannelRead() {
  const qc = useQueryClient()
  return useMutation({
    ...chatMarkReadMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatChannelsListQueryKey() }),
  })
}

// ─────────────────────────────────────────────────────────────
// Campaign validation (for booking dialog)
// ─────────────────────────────────────────────────────────────

export function useValidateCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { code: string; subtotal: number }) => {
      const { data, error } = await sdkValidateCampaign({ query: params })
      if (error) throw error
      return data
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Review creation (for review dialog)
// ─────────────────────────────────────────────────────────────

export function useCreateReview() {
  const qc = useQueryClient()
  return useMutation({
    ...reviewCreateMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: reviewsListQueryKey() }),
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

export function useUpdateAdminBrand() {
  const qc = useQueryClient()
  return useMutation({
    ...updateBrandMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminBrandsListQueryKey() })
      qc.invalidateQueries({ queryKey: ['brands'] })
    },
  })
}

export function useDeleteAdminBrand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await sdkDeleteBrand({ path: { id }, throwOnError: true })
      return data
    },
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

export function useUpdateAdminRoute() {
  const qc = useQueryClient()
  return useMutation({
    ...updateRouteMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminRoutesListQueryKey() })
      qc.invalidateQueries({ queryKey: ['routes'] })
    },
  })
}

export function useDeleteAdminRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await sdkDeleteRoute({ path: { id }, throwOnError: true })
      return data
    },
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

export function useUpdateAdminSchedule() {
  const qc = useQueryClient()
  return useMutation({
    ...updateScheduleMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'schedules'] }),
  })
}

export function useDeleteAdminSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await sdkDeleteSchedule({ path: { id }, throwOnError: true })
      return data
    },
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

export function useUpdateAdminPickupPoint() {
  const qc = useQueryClient()
  return useMutation({
    ...updatePickupPointMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pickup-points'] }),
  })
}

export function useDeleteAdminPickupPoint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await sdkDeletePickupPoint({ path: { id }, throwOnError: true })
      return data
    },
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
    mutationFn: async (vars: {
      id: string
      status?: string | null
      brandReply?: string | null
    }) => {
      const { data } = await sdkModerateReview({
        path: { id: vars.id },
        body: { status: vars.status, brandReply: vars.brandReply },
        throwOnError: true,
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminReviewsListQueryKey() })
      qc.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}

export function useDeleteAdminReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await sdkDeleteAdminReview({ path: { id }, throwOnError: true })
      return data
    },
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

function adminBookingsQs(filter: AdminBookingFilter) {
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
  return sp
}

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
    mutationFn: async (vars: {
      id: string
      status: string
      reason?: string | null
      force?: boolean
    }) => {
      const { data } = await sdkUpdateBookingStatus({
        path: { id: vars.id },
        body: {
          status: vars.status,
          reason: vars.reason ?? null,
          force: vars.force ?? false,
        },
        throwOnError: true,
      })
      return data
    },
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
  const sp = adminBookingsQs(filter)
  const query: Record<string, string> = {}
  sp.forEach((v: string, k: string) => { query[k] = v })
  return useQuery({
    ...adminBookingExportOptions({ query } as any),
    enabled: false, // only fetch on demand via refetch
  })
}
