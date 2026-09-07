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

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";

// NOTE: no bare SDK imports for hooks — all use generated TanStack
// Options/Mutation helpers from @tanstack/react-query.gen. The two
// `fetch*Page` helpers below (consumed by the infinite-scroll picker's
// own useInfiniteQuery) are the exception: they call the raw SDK list
// functions directly.
import {
  list as listAddresses,
  list10 as listVehicleTypes,
} from "@/lib/api/sdk.gen";

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
  // places (list13 = /api/places, search = /api/places/search)
  searchOptions as placeSearchOptions,
  list13Options as placeListOptions,
  // reviews (list15 = /api/reviews, tags = /api/reviews/tags)
  list15Options as reviewsListOptions,
  list15QueryKey as reviewsListQueryKey,
  tagsOptions as reviewTagsOptions,
  update8Mutation as reviewUpdateMutation,
  create8Mutation as reviewCreateMutation,
  // reviews — my own reviews (paginated, /api/reviews/mine)
  mineOptions as reviewsMineOptions,
  mineQueryKey as reviewsMineQueryKey,
  // bookings (list11 = GET /api/bookings — the user's own bookings)
  list11Options as bookingsListOptions,
  detailOptions as bookingDetailOptions,
  lookupOptions as bookingLookupOptions,
  holdMutation,
  confirmMutation,
  cancel2Mutation,
  // price alerts (list14 = /api/price-alerts, create7 = POST /api/price-alerts)
  list14Options as priceAlertsListOptions,
  list14QueryKey as priceAlertsListQueryKey,
  create7Mutation as priceAlertCreateMutation,
  removeMutation as priceAlertRemoveMutation,
  // notifications (list12 = /api/notifications)
  list12Options as notificationsListOptions,
  list12QueryKey as notificationsListQueryKey,
  markRead2Mutation as notificationsMarkReadMutation,
  // wishlist (list16 = /api/wishlist)
  list16Options as wishlistListOptions,
  list16QueryKey as wishlistListQueryKey,
  toggleMutation as wishlistToggleMutation,
  remove3Mutation as wishlistRemoveMutation,
  // stats (stats2 = /api/stats — public, stats = /api/admin/bookings/stats)
  stats2Options,
  // admin — brands (list3/create2/delete2/update2)
  list3Options as adminBrandsListOptions,
  list3QueryKey as adminBrandsListQueryKey,
  create2Mutation as createBrandMutation,
  delete2Mutation as deleteBrandMutation,
  // admin — routes (list7/create4/delete5/update4)
  list8Options as adminRoutesListOptions,
  list8QueryKey as adminRoutesListQueryKey,
  create4Mutation as createRouteMutation,
  delete5Mutation as deleteRouteMutation,
  // admin — schedules (list8/create5/delete6/update5)
  list9Options as adminSchedulesListOptions,
  list9QueryKey as adminSchedulesListQueryKey,
  create5Mutation as createScheduleMutation,
  delete6Mutation as deleteScheduleMutation,
  // cron jobs (recurring background jobs)
  list5Options as cronJobsListOptions,
  list5QueryKey as cronJobsListQueryKey,
  listRunsOptions as cronJobRunsListOptions,
  listRunsQueryKey as cronJobRunsListQueryKey,
  update3Mutation as updateCronJobMutation,
  triggerMutation as triggerCronJobMutation,
  cancelMutation as cancelCronJobMutation,
  // admin — vehicle types (list10 = /api/admin/vehicle-types)
  list10Options as adminVehicleTypesListOptions,
  list10QueryKey as adminVehicleTypesListQueryKey,
  create6Mutation as createVehicleTypeMutation,
  update7Mutation as updateVehicleTypeMutation,
  delete7Mutation as deleteVehicleTypeMutation,
  // admin — pickup points (list5/create3/delete3)
  list6Options as adminPickupPointsListOptions,
  create3Mutation as createPickupPointMutation,
  delete3Mutation as deletePickupPointMutation,
  // admin — bus layouts (list4)
  list4Options as adminBusLayoutsListOptions,
  // admin — reviews (list6)
  list7Options as adminReviewsListOptions,
  list7QueryKey as adminReviewsListQueryKey,
  // admin — per-brand feedback aggregates (/api/admin/reviews/summary)
  summaryOptions as adminReviewsSummaryOptions,
  summaryQueryKey as adminReviewsSummaryQueryKey,
  moderateMutation,
  // admin — addresses (list/create/delete_/update — unnumbered, first alphabetically)
  listOptions as adminAddressesListOptions,
  listQueryKey as adminAddressesListQueryKey,
  createMutation as createAddressMutation,
  updateMutation as updateAddressMutation,
  deleteMutation as deleteAddressMutation,
  // admin — bookings (list2)
  list2Options as adminBookingsListOptions,
  getOptions as adminGetBookingOptions,
  statsOptions as adminBookingStatsOptions,
  exportOptions as adminBookingExportOptions,
  updateStatusMutation,
  // chat
  listChannelsOptions as chatChannelsListOptions,
  listMessagesOptions as chatMessagesListOptions,
  listMessagesInfiniteOptions as chatMessagesListInfiniteOptions,
  listMessagesInfiniteQueryKey as chatMessagesListInfiniteQueryKey,
  postMessageMutation as chatPostMessageMutation,
  createChannelMutation as chatCreateChannelMutation,
  markReadMutation as chatMarkReadMutation,
  listUsersOptions,
  setUserRoleMutation,
  claimChannelMutation as chatClaimChannelMutation,
  releaseChannelMutation as chatReleaseChannelMutation,
  closeChannelMutation as chatCloseChannelMutation,
  getStaffPresenceOptions,
} from "@/lib/api/@tanstack/react-query.gen";

// Generated types — re-exported so components can import from here
import type {
  BrandOut,
  CampaignOut,
  NotificationOut,
  PlaceOut,
  PlaceSearchHit,
  PriceAlertOut,
  ReviewOut,
  RouteOut,
  SessionUser,
  TripDetail,
  TripResult,
  WishlistItemOut,
  AdminBrandOut,
  AdminBookingExportResponse,
  AdminBookingListResponse,
  AdminBookingOut,
  AdminBookingStatsResponse,
  AdminMutationResponse,
  AdminPickupPointOut,
  AdminReviewListResponse,
  AdminRouteOut,
  AdminScheduleOut,
  AdminVehicleTypeOut,
  AdminVehicleTypeListResponse,
  AdminAddressOut,
  AdminAddressListResponse,
  CronJobRunOut,
} from "@/lib/api/types.gen";

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
  AdminVehicleTypeOut as AdminVehicleType,
  AdminAddressOut as AdminAddress,
  CronJobRunOut as CronJobRun,
};

// Convenience types used by components
export type ListEnvelope<T> = {
  items: T[];
  total?: number | null;
  unread?: number;
};

export type TripSearchParams = {
  from: string;
  to: string;
  date: string;
  adults?: number;
  children?: number;
  sort?: string;
  vehicleTypes?: string[];
  roundTrip?: boolean;
  returnDate?: string;
};

export type RecommendationItem = TripResult;

// Admin booking filter shape (used by the tickets panel)
export type AdminBookingFilter = {
  brandId?: string;
  routeId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  range?: string;
  search?: string;
  limit?: number | null;
  offset?: number | null;
  sort?: string;
};

// ─────────────────────────────────────────────────────────────
// Brands
// ─────────────────────────────────────────────────────────────

export function useBrands() {
  return useQuery({
    ...brandsOptions(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useBrand(slug: string | undefined) {
  return useQuery({
    ...brandDetailOptions({ path: { slug: slug! } }),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────

export function usePopularRoutes() {
  return useQuery({
    ...routesOptions(),
    staleTime: 10 * 60 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────
// Trips — search + detail + recommendations
// ─────────────────────────────────────────────────────────────

/** Build the typed query params the generated SDK expects. */
function tripSearchQuery(params: TripSearchParams) {
  const minSeats = (params.adults ?? 1) + (params.children ?? 0);
  return {
    from: params.from,
    to: params.to,
    date: params.date,
    sort: params.sort ?? "departure",
    minSeats,
    vehicleTypes:
      params.vehicleTypes && params.vehicleTypes.length
        ? params.vehicleTypes.join(",")
        : undefined,
  };
}

export function useTripSearch(params: TripSearchParams | null) {
  // Always build a query object so the generated options' queryKey stays
  // well-typed (the SDK keys cache by the query params, so the same
  // from/to/date share the same cache entry regardless of where the hook
  // is mounted). When `params` is null we pass empty placeholders and
  // disable the query via `enabled` so no request fires.
  const query = tripSearchQuery(params ?? { from: "", to: "", date: "" });
  return useQuery({
    ...searchTripsOptions({ query }),
    enabled: !!params && (!!params.from || !!params.to) && !!params.date,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

export function useTripDetail(tripId: string | undefined) {
  return useQuery({
    ...tripDetailOptions({ path: { id: tripId! } }),
    enabled: !!tripId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useRecommendations() {
  return useQuery({
    ...recommendationsOptions(),
    staleTime: 60 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────
// Campaigns
// ─────────────────────────────────────────────────────────────

export function useCampaigns() {
  return useQuery({
    ...campaignsOptions(),
    staleTime: 5 * 60 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────
// Places — autocomplete + reverse geocode
// ─────────────────────────────────────────────────────────────

export function usePlaceSearch(q: string, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? q.trim().length >= 1;
  return useQuery({
    ...placeSearchOptions({ query: { q, limit: 20 } }),
    enabled,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function usePlacesList(limit = 50) {
  return useQuery({
    ...placeListOptions({ query: { limit: limit ?? null } }),
    staleTime: 5 * 60 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────

export function useReviewsByRoute(routeId: string | undefined) {
  return useQuery({
    ...reviewsListOptions({ query: { route_id: routeId, limit: 20 } }),
    enabled: !!routeId,
    staleTime: 60 * 1000,
  });
}

export function useReviewsByBrand(brandId: string | undefined) {
  return useQuery({
    ...reviewsListOptions({ query: { brand_id: brandId, limit: 20 } }),
    enabled: !!brandId,
    staleTime: 60 * 1000,
  });
}

/**
 * The caller's OWN reviews — server-side paginated via
 * `GET /api/reviews/mine` (user scope forced by the backend, never
 * spoofable via query params). Returns `{ items, total, limit, offset }`
 * so the feedback history page can render true page controls.
 *
 * Keep `enabled` gated on a logged-in user — the endpoint 401s for
 * guests.
 */
export function useMyReviews(opts?: {
  enabled?: boolean;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const status = (opts?.status ?? "").trim();
  return useQuery({
    ...reviewsMineOptions({
      query: {
        status: status || undefined,
        limit: opts?.limit ?? 10,
        offset: opts?.offset ?? 0,
      },
    }),
    enabled: opts?.enabled ?? true,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

export function useReviewTags() {
  return useQuery({
    ...reviewTagsOptions(),
    staleTime: 60 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────
// Bookings
// ─────────────────────────────────────────────────────────────

export function useMyBookings(status?: string) {
  return useQuery({
    ...bookingsListOptions({ query: { status: status ?? "all" } }),
    staleTime: 30 * 1000,
  });
}

export function useBooking(code: string | undefined) {
  return useQuery({
    ...bookingDetailOptions({ path: { id: code! } }),
    enabled: !!code,
    staleTime: 30 * 1000,
  });
}

export function useGuestBookings(phone: string | undefined, code?: string) {
  return useQuery({
    ...bookingLookupOptions({
      query: { phone: phone ?? undefined, code: code ?? undefined },
    }),
    enabled: !!phone || !!code,
    staleTime: 30 * 1000,
  });
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
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (err: unknown, vars: TVars) => void;
  onSettled?: (
    data: TData | undefined,
    err: unknown | null,
    vars: TVars,
  ) => void;
};

// ─────────────────────────────────────────────────────────────
// Bookings — hold / confirm / cancel
// ─────────────────────────────────────────────────────────────

export function useCancelBooking<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(cancel2Mutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

export function useHoldBooking<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(holdMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

export function useConfirmBooking<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(confirmMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
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
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    ...notificationsMarkReadMutation(),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: notificationsListQueryKey() }),
  });
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
  });
}

export function useToggleWishlist() {
  const qc = useQueryClient();
  return useMutation({
    ...wishlistToggleMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: wishlistListQueryKey() }),
  });
}

export function useRemoveWishlist() {
  const qc = useQueryClient();
  return useMutation({
    ...wishlistRemoveMutation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: wishlistListQueryKey() }),
  });
}

// ─────────────────────────────────────────────────────────────
// Price alerts  (generated TanStack client — @hey-api/openapi-ts)
// ─────────────────────────────────────────────────────────────

export function usePriceAlerts(phone?: string | null) {
  const opts = priceAlertsListOptions({ query: { phone: phone ?? undefined } });
  return useQuery({
    queryKey: opts.queryKey,
    queryFn: opts.queryFn as any,
    staleTime: 60 * 1000,
    select: (data: any) => ({
      items: (data?.items ?? []).map((a: any) => ({
        ...a,
        targetPrice: a.targetPrice ?? 0,
        maxPrice: a.targetPrice ?? 0,
        status: a.status ?? "active",
      })),
      total: data?.total ?? null,
      limit: data?.limit ?? 200,
      offset: data?.offset ?? 0,
    }),
  });
}

export function useCreatePriceAlert() {
  const qc = useQueryClient();
  return useMutation({
    ...priceAlertCreateMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: priceAlertsListQueryKey() });
      qc.invalidateQueries({ queryKey: ["price-alerts"] });
    },
  });
}

export function useRemovePriceAlert() {
  const qc = useQueryClient();
  return useMutation({
    ...priceAlertRemoveMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: priceAlertsListQueryKey() });
      qc.invalidateQueries({ queryKey: ["price-alerts"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Auth  (generated TanStack client)
// ─────────────────────────────────────────────────────────────

export function useAuthMe() {
  return useQuery({
    ...meOptions(),
    retry: false,
    staleTime: 5 * 60 * 1000,
    select: (data) =>
      data ? { user: data.user as unknown as SessionUser } : null,
  });
}

export function useLogout<TData = unknown>(
  opts?: MutationCallbacks<TData, void>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, void>({
    ...(logoutMutation() as any),
    onSuccess: (data, vars) => {
      qc.clear();
      qc.removeQueries({ queryKey: meQueryKey() });
      opts?.onSuccess?.(data as TData, vars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars),
  });
}

export function useLogin<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(loginMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: meQueryKey() });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

export function useRegister<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(registerMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: meQueryKey() });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

export function useEmployeeLogin<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(employeeLoginMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: meQueryKey() });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

// ─────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────

export function useStats() {
  return useQuery({
    ...stats2Options(),
    staleTime: 60 * 1000,
  });
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
  });
}

/**
 * `useChatStats` — aggregate chat stats for the admin dashboard's
 * top-row cards (open / assigned / closed counts + avg response time).
 *
 * Server-side aggregate so the counts are accurate even when there
 * are more channels than the channel list's page size (capped at 200).
 *
 * Refetches every 15s + on WS invalidation (the WS hook invalidates
 * the `listChannels` query which this piggybacks on).
 */
export type ChatStats = {
  openCount: number;
  assignedCount: number;
  closedCount: number;
  totalChannels: number;
  avgResponseTimeSecs: number;
};

export function useChatStats() {
  return useQuery<ChatStats>({
    queryKey: ["admin", "chat", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/chat/stats", {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Origin: window.location.origin,
        },
      });
      if (!res.ok) throw new Error("Failed to fetch chat stats");
      return res.json();
    },
    refetchInterval: 15 * 1000,
    staleTime: 10 * 1000,
  });
}

/**
 * `useSystemStatus` — system monitoring data for /admin/system.
 * Refetches every 5s for near-real-time metrics.
 */
export type SystemStatus = {
  uptime: { seconds: number; human: string };
  websocket: {
    connections: number;
    maxConnections: number;
    rooms: number;
    idempotencyEntries: number;
    onlineEmployeeBrands: number;
    onlineEmployees: number;
    distinctIps: number;
  };
  database: {
    backend: string;
    urlMasked: string;
    maxConnections: number;
    minConnections: number;
    activeConnections: number;
    idleConnections: number;
    sizeMb: number;
  };
  process: {
    pid: number;
    memoryMb: number;
    virtualMemoryMb: number;
    cpuUsage: number;
    cpuCount: number;
    osName: string;
    osVersion: string;
    hostname: string;
  };
};

export function useSystemStatus() {
  return useQuery<SystemStatus>({
    queryKey: ["admin", "system"],
    queryFn: async () => {
      const res = await fetch("/api/admin/system", {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Origin: window.location.origin,
        },
      });
      if (!res.ok) throw new Error("Failed to fetch system status");
      return res.json();
    },
    refetchInterval: 5 * 1000,
  });
}

export function useChatMessages(channelId: string | undefined, limit = 50) {
  const opts = channelId
    ? chatMessagesListOptions({ path: { id: channelId }, query: { limit } })
    : null;
  return useQuery<any>({
    queryKey: opts?.queryKey ?? ["chat", "messages", "disabled"],
    queryFn: (opts?.queryFn as any) ?? (() => Promise.resolve(null)),
    enabled: !!channelId,
    staleTime: 10 * 1000,
    // No polling — the admin chat workspace subscribes to the WS
    // hub for realtime new messages. Polling would just add load
    // without improving UX (WS already gives instant updates).
  });
}

/**
 * `useChatMessagesInfinite` — infinite-scroll hook for chat messages.
 *
 * Uses TanStack Query's `useInfiniteQuery` to fetch messages in pages
 * of `pageSize` (default 30). The backend returns each page in DESC
 * order (newest first) to support cursor pagination; this hook
 * reverses each page so the final display order is chronological
 * (oldest at the top, newest at the bottom — the natural chat
 * reading order).
 *
 * ## How infinite scroll works
 *
 *   1. Initial load: `offset=0, limit=30` → the 30 newest messages,
 *      reversed for display.
 *   2. User scrolls to the top → `fetchNextPage()` is called →
 *      `offset=30, limit=30` → the next 30 older messages, reversed
 *      + prepended to the display list.
 *   3. Repeat until `hasNextPage` is false (the page returned fewer
 *      than `pageSize` items — we've reached the beginning of the
 *      conversation).
 *
 * ## Why reverse each page (not the whole list)
 *
 * Each page arrives as `[newest, ..., oldest]` (DESC). Reversing
 * each page independently gives `[oldest, ..., newest]` for that
 * page. Concatenating pages in fetch order (page 0 first, then
 * page 1, ...) gives the full chronological list:
 *
 *   page 0 reversed: [oldest_of_page_0, ..., newest_of_page_0]
 *   page 1 reversed: [oldest_of_page_1, ..., newest_of_page_1]
 *   concat: [oldest_of_page_1, ..., newest_of_page_1, oldest_of_page_0, ..., newest_of_page_0]
 *
 * The newest message is at the END of the array — correct for
 * rendering (bottom of the chat).
 *
 * ## Realtime updates
 *
 * When a new message arrives via WS, the caller invalidates the
 * `listMessages` query (partial key match). TanStack refetches the
 * FIRST page (offset=0) — which now includes the new message at the
 * top of the DESC page → after reverse, the new message is at the
 * bottom of the display list. Older pages are NOT refetched (they're
 * unchanged) — efficient.
 *
 * ## `getNextPageParam`
 *
 * Returns the next `offset` (= current total items fetched) when the
 * last page returned a full `pageSize` (i.e. there might be more
 * older messages). Returns `undefined` when the last page was
 * partial (= we've reached the beginning of the conversation).
 *
 * ## `getPreviousPageParam`
 *
 * Returns 0 for the first page (so TanStack can refetch it on
 * invalidation). Not used for backward pagination (we only paginate
 * forward in time via `fetchNextPage`).
 */
export function useChatMessagesInfinite(
  channelId: string | undefined,
  pageSize = 30,
) {
  const opts = channelId
    ? chatMessagesListInfiniteOptions({
        path: { id: channelId },
        query: { limit: pageSize },
      })
    : null;

  const query = useInfiniteQuery<any>({
    queryKey: opts?.queryKey ?? ["chat", "messages", "infinite", "disabled"],
    queryFn: (opts?.queryFn as any) ?? (() => Promise.resolve(null)),
    initialPageParam: 0,
    getNextPageParam: (lastPage: any, allPages: any[], lastPageParam: any) => {
      // `lastPage` is the API response: `{ items: [...] }`.
      // Each page is DESC (newest first). The page size is the
      // requested `pageSize`. If the last page returned fewer items
      // than `pageSize`, we've reached the beginning → no more pages.
      const items = lastPage?.items ?? [];
      if (items.length < pageSize) return undefined;
      // Next offset = sum of all previously fetched page sizes.
      // `allPages` is the array of all fetched pages so far.
      const totalFetched = allPages.reduce(
        (sum, p) => sum + (p?.items?.length ?? 0),
        0,
      );
      return totalFetched;
    },
    getPreviousPageParam: () => 0,
    enabled: !!channelId,
    staleTime: 10 * 1000,
    // No polling — WS delivers new messages instantly.
  });

  // Flatten + reverse each page for chronological display.
  //
  // The backend returns each page as DESC (newest first). We reverse
  // each page independently so the display order is:
  //   [oldest_of_oldest_page, ..., newest_of_oldest_page, oldest_of_newest_page, ..., newest_of_newest_page]
  //
  // The newest message ends up at the END of the array — correct for
  // rendering (bottom of the chat).
  const pages = query.data?.pages ?? [];
  const messages: any[] = [];
  for (const page of pages) {
    const items = page?.items ?? [];
    // Reverse the page (DESC → ASC) + push to the messages array.
    // This preserves chronological order across pages.
    for (let i = items.length - 1; i >= 0; i--) {
      messages.push(items[i]);
    }
  }

  return {
    // The chronological messages array (oldest first, newest last).
    messages,
    // The raw TanStack query result (for `isFetching`, `hasNextPage`, etc.).
    query,
    // Convenience: whether we're currently fetching the next page
    // (for showing a "Loading more..." spinner at the top of the chat).
    isFetchingNextPage: query.isFetchingNextPage,
    // Whether there might be more older messages to load.
    hasNextPage: query.hasNextPage,
    // Call this when the user scrolls to the top of the chat.
    fetchNextPage: query.fetchNextPage,
  };
}

export function usePostChatMessage<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(chatPostMessageMutation() as any),
    onSuccess: (data, vars) => {
      // Use partial key match to invalidate all listMessages + listChannels
      // queries (the generated keys are object arrays, not string arrays).
      qc.invalidateQueries({ queryKey: [{ _id: "listMessages" }] });
      qc.invalidateQueries({ queryKey: [{ _id: "listChannels" }] });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

/**
 * Create a chat channel (or return the existing open one — the
 * backend enforces 1 open channel per user). Invalidates the
 * channels list so the new/existing channel appears immediately.
 */
export function useCreateChatChannel<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(chatCreateChannelMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: [{ _id: "listChannels" }] });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

/**
 * Mark a chat channel as read by the current user. Invalidates the
 * channels list so the unread badge clears immediately.
 */
export function useMarkChatRead<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(chatMarkReadMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: [{ _id: "listChannels" }] });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

// ─────────────────────────────────────────────────────────────
// Chat assignment actions (three-role routing spec)
// ─────────────────────────────────────────────────────────────

/** Claim a channel (assign it to the logged-in staff member). */
export function useClaimChannel() {
  const qc = useQueryClient();
  return useMutation({
    ...chatClaimChannelMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [{ _id: "listChannels" }] });
      qc.invalidateQueries({ queryKey: ["chatStats"] });
    },
  });
}

/** Release a channel back to the open queue (assignee or admin). */
export function useReleaseChannel() {
  const qc = useQueryClient();
  return useMutation({
    ...chatReleaseChannelMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [{ _id: "listChannels" }] });
      qc.invalidateQueries({ queryKey: ["chatStats"] });
    },
  });
}

/** Close a channel (ends any assignment). */
export function useCloseChannel() {
  const qc = useQueryClient();
  return useMutation({
    ...chatCloseChannelMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [{ _id: "listChannels" }] });
      qc.invalidateQueries({ queryKey: ["chatStats"] });
    },
  });
}

/**
 * Staff presence snapshot (REST bootstrap for the admin chat panel's
 * presence column). The WS `staff_presence` broadcasts keep it live
 * afterwards — this hook covers first paint + reconnects.
 */
export function useStaffPresence() {
  return useQuery({
    ...getStaffPresenceOptions(),
    // WS pushes updates; the REST query is a fallback refresher.
    refetchInterval: 60 * 1000,
    staleTime: 15 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────
// Campaign validation (for booking dialog)
// ─────────────────────────────────────────────────────────────

export function useValidateCampaign<TData = unknown>(
  opts?: MutationCallbacks<TData, { code: string; subtotal: number }>,
) {
  return useMutation<TData, unknown, { code: string; subtotal: number }>({
    mutationFn: async (params: { code: string; subtotal: number }) => {
      const o = validateCampaignOptions({ query: params });
      const queryFn = o.queryFn;
      if (!queryFn) throw new Error("queryFn missing");
      return queryFn({
        queryKey: o.queryKey as any,
        signal: new AbortController().signal,
      } as any) as Promise<TData>;
    },
    onSuccess: (data, vars) => opts?.onSuccess?.(data, vars),
    onError: (err, vars) => opts?.onError?.(err, vars),
    onSettled: (data, err, vars) => opts?.onSettled?.(data, err, vars),
  });
}

// ─────────────────────────────────────────────────────────────
// Review creation (for review dialog)
// ─────────────────────────────────────────────────────────────

export function useCreateReview<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(reviewCreateMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: reviewsListQueryKey() });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

export function useUpdateReview<TData = unknown, TVars = unknown>(
  opts?: MutationCallbacks<TData, TVars>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    ...(reviewUpdateMutation() as any),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: reviewsListQueryKey() });
      opts?.onSuccess?.(data as TData, vars as TVars);
    },
    onError: (err, vars) => opts?.onError?.(err, vars as TVars),
    onSettled: (data, err, vars) =>
      opts?.onSettled?.(data as TData | undefined, err, vars as TVars),
  });
}

// ─────────────────────────────────────────────────────────────
// Admin — Brands
// ─────────────────────────────────────────────────────────────

export function useAdminBrands() {
  return useQuery({
    ...adminBrandsListOptions(),
    staleTime: 30 * 1000,
  });
}

export function useUpsertAdminBrand() {
  const qc = useQueryClient();
  return useMutation({
    ...createBrandMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminBrandsListQueryKey() });
      qc.invalidateQueries({ queryKey: ["brands"] });
    },
  });
}

export function useDeleteAdminBrand() {
  const qc = useQueryClient();
  return useMutation({
    ...deleteBrandMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminBrandsListQueryKey() });
      qc.invalidateQueries({ queryKey: ["brands"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Admin — Routes
// ─────────────────────────────────────────────────────────────

export function useAdminRoutes(query?: {
  brandId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    ...adminRoutesListOptions({ query }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

export function useUpsertAdminRoute() {
  const qc = useQueryClient();
  return useMutation({
    ...createRouteMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminRoutesListQueryKey() });
      qc.invalidateQueries({ queryKey: ["routes"] });
    },
  });
}

export function useDeleteAdminRoute() {
  const qc = useQueryClient();
  return useMutation({
    ...deleteRouteMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminRoutesListQueryKey() });
      qc.invalidateQueries({ queryKey: ["routes"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Admin — Addresses (brand-owned points for schedule sequences)
// ─────────────────────────────────────────────────────────────

/** List a brand's addresses — options for the schedule point selects. */
export function useAdminAddresses(brandId?: string) {
  return useQuery({
    ...adminAddressesListOptions({ query: { brandId } }),
    enabled: !!brandId,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch one page of a brand's addresses for the searchable,
 * infinite-scroll schedule point picker. Mirrors the vehicle-types
 * page fetcher: (page, search, signal) → { items, total, hasMore }.
 * `signal` aborts superseded searches at the HTTP level.
 */
export async function fetchAdminAddressesPage(
  brandId: string,
  page: number,
  search: string,
  pageSize = 25,
  signal?: AbortSignal,
): Promise<{ items: AdminAddressOut[]; total: number; hasMore: boolean }> {
  const { data } = await listAddresses({
    query: {
      brandId,
      q: search.trim() || undefined,
      limit: pageSize,
      offset: page * pageSize,
    },
    signal,
  });
  const body = (data ?? { items: [], total: 0 }) as AdminAddressListResponse;
  const offset = page * pageSize;
  return {
    items: body.items ?? [],
    total: body.total ?? 0,
    hasMore: offset + (body.items?.length ?? 0) < (body.total ?? 0),
  };
}

/**
 * Create an address (usually from the map picker modal inside the
 * schedule form). Returns the created id so the caller can immediately
 * select it in the point select.
 */
export function useCreateAdminAddress() {
  const qc = useQueryClient();
  return useMutation({
    ...createAddressMutation(),
    onSuccess: (_data, vars: any) => {
      // Invalidate the whole admin-addresses key family — the brandId
      // filter may differ between consumers.
      qc.invalidateQueries({ queryKey: ["admin", "addresses"] });
      qc.invalidateQueries({ queryKey: adminAddressesListQueryKey() });
      void vars;
    },
  });
}

export function useUpdateAdminAddress() {
  const qc = useQueryClient();
  return useMutation({
    ...updateAddressMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "addresses"] });
      qc.invalidateQueries({ queryKey: adminAddressesListQueryKey() });
    },
  });
}

export function useDeleteAdminAddress() {
  const qc = useQueryClient();
  return useMutation({
    ...deleteAddressMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "addresses"] });
      qc.invalidateQueries({ queryKey: adminAddressesListQueryKey() });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Admin — Schedules
// ─────────────────────────────────────────────────────────────

export function useAdminSchedules(routeId?: string) {
  return useQuery({
    ...adminSchedulesListOptions({ query: { routeId } }),
    enabled: !!routeId,
    staleTime: 30 * 1000,
  });
}

export function useUpsertAdminSchedule() {
  const qc = useQueryClient();
  return useMutation({
    ...createScheduleMutation(),
    onSuccess: () => {
      // Invalidate the GENERATED key (["list8", {...}]) — the previous
      // literal ["admin", "schedules"] never matched it, so schedule
      // lists did not refresh after create/update.
      qc.invalidateQueries({ queryKey: adminSchedulesListQueryKey() });
    },
  });
}

export function useDeleteAdminSchedule() {
  const qc = useQueryClient();
  return useMutation({
    ...deleteScheduleMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSchedulesListQueryKey() });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Admin — Pickup points
// ─────────────────────────────────────────────────────────────

export function useAdminPickupPoints(routeId?: string) {
  return useQuery({
    ...adminPickupPointsListOptions({ query: { routeId } }),
    enabled: !!routeId,
    staleTime: 30 * 1000,
  });
}

export function useUpsertAdminPickupPoint() {
  const qc = useQueryClient();
  return useMutation({
    ...createPickupPointMutation(),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin", "pickup-points"] }),
  });
}

export function useDeleteAdminPickupPoint() {
  const qc = useQueryClient();
  return useMutation({
    ...deletePickupPointMutation(),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin", "pickup-points"] }),
  });
}

// ─────────────────────────────────────────────────────────────
// Admin — Reviews moderation
// ─────────────────────────────────────────────────────────────

export function useAdminReviews(opts?: {
  status?: string;
  brandId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const status = opts?.status ?? "";
  const brandId = opts?.brandId ?? "";
  const search = (opts?.search ?? "").trim();
  return useQuery({
    ...adminReviewsListOptions({
      query: {
        status: status || undefined,
        brandId: brandId || undefined,
        search: search || undefined,
        limit: opts?.limit ?? 20,
        offset: opts?.offset ?? 0,
      },
    }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

/**
 * Per-brand feedback aggregates (volume / status counts / avg rating)
 * for the admin feedback page's brand cards. Sorted server-side by
 * feedback volume desc.
 */
export function useAdminReviewBrandSummary() {
  return useQuery({
    ...adminReviewsSummaryOptions(),
    staleTime: 60 * 1000,
  });
}

export function useModerateAdminReview() {
  const qc = useQueryClient();
  return useMutation({
    ...moderateMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminReviewsListQueryKey() });
      qc.invalidateQueries({ queryKey: adminReviewsSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: ["reviews"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Admin — Bus layouts
// ─────────────────────────────────────────────────────────────

export function useAdminBusLayouts(query?: {
  brandId?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    ...adminBusLayoutsListOptions({ query }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

// ─────────────────────────────────────────────────────────────
// Admin — Vehicle types (schedule form's "Loại xe" catalog)
// ─────────────────────────────────────────────────────────────

/** List the vehicle-type catalog with filter + offset pagination. */
export function useAdminVehicleTypes(query?: {
  q?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    ...adminVehicleTypesListOptions({ query }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch one page of vehicle types for the infinite-scroll picker.
 * Signature matches `InfiniteFetchPage`; `signal` aborts superseded
 * searches at the HTTP level.
 */
export async function fetchVehicleTypesPage(
  page: number,
  search: string,
  signal?: AbortSignal,
  pageSize = 25,
): Promise<{ items: AdminVehicleTypeOut[]; total: number; hasMore: boolean }> {
  const { data } = await listVehicleTypes({
    query: {
      q: search.trim() || undefined,
      limit: pageSize,
      offset: page * pageSize,
    },
    signal,
  });
  const body = (data ?? {
    items: [],
    total: 0,
  }) as AdminVehicleTypeListResponse;
  const offset = page * pageSize;
  return {
    items: body.items ?? [],
    total: body.total ?? 0,
    hasMore: offset + (body.items?.length ?? 0) < (body.total ?? 0),
  };
}

export function useCreateAdminVehicleType() {
  const qc = useQueryClient();
  return useMutation({
    ...createVehicleTypeMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminVehicleTypesListQueryKey() });
      qc.invalidateQueries({ queryKey: ["admin", "vehicle-types"] });
    },
  });
}

export function useUpdateAdminVehicleType() {
  const qc = useQueryClient();
  return useMutation({
    ...updateVehicleTypeMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminVehicleTypesListQueryKey() });
      qc.invalidateQueries({ queryKey: ["admin", "vehicle-types"] });
    },
  });
}

export function useDeleteAdminVehicleType() {
  const qc = useQueryClient();
  return useMutation({
    ...deleteVehicleTypeMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminVehicleTypesListQueryKey() });
      qc.invalidateQueries({ queryKey: ["admin", "vehicle-types"] });
    },
  });
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
        status:
          filter.status && filter.status !== "all" ? filter.status : undefined,
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
  });
}

export function useAdminBookingDetail(id: string | undefined) {
  return useQuery({
    ...adminGetBookingOptions({ path: { id: id! } }),
    enabled: !!id,
    staleTime: 15 * 1000,
  });
}

export function useAdminBookingStats(filter: AdminBookingFilter) {
  return useQuery({
    ...adminBookingStatsOptions({
      query: {
        brandId: filter.brandId,
        routeId: filter.routeId,
        status:
          filter.status && filter.status !== "all" ? filter.status : undefined,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        search: filter.search,
        limit: filter.limit ?? 50,
        offset: filter.offset ?? 0,
        sort: filter.sort,
      },
    }),
    staleTime: 30 * 1000,
  });
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient();
  return useMutation({
    ...updateStatusMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useAdminCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    ...holdMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useAdminBookingExport(filter: AdminBookingFilter) {
  const query: Record<string, string | number | undefined> = {
    brandId: filter.brandId,
    routeId: filter.routeId,
    status:
      filter.status && filter.status !== "all" ? filter.status : undefined,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    search: filter.search,
    limit: filter.limit ?? 50,
    offset: filter.offset ?? 0,
    sort: filter.sort,
  };
  // Remove undefined values
  Object.keys(query).forEach((k) => query[k] === undefined && delete query[k]);
  return useQuery({
    ...adminBookingExportOptions({ query } as any),
    enabled: false, // only fetch on demand via refetch
  });
}

// ─── Cron jobs (recurring background jobs) ────────────────────────────

/**
 * Scheduled jobs with next run + latest run. Auto-refreshes so a
 * running job's live status / progress shows up without manual reload.
 */
export function useAdminCronJobs() {
  return useQuery({
    ...cronJobsListOptions(),
    refetchInterval: 10 * 1000,
  });
}

/** Run history, most recent first (optionally filtered by job type). */
export function useAdminCronJobRuns(jobType?: string) {
  return useQuery({
    ...cronJobRunsListOptions({ query: { jobType } }),
    refetchInterval: 10 * 1000,
  });
}

/** PATCH a schedule: enable/disable, cadence, fire time, re-arm. */
export function useUpdateCronJob() {
  const qc = useQueryClient();
  return useMutation({
    ...updateCronJobMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cronJobsListQueryKey() });
    },
  });
}

/** Trigger ("run now") a job — 409 when one is already in flight. */
export function useTriggerCronJob() {
  const qc = useQueryClient();
  return useMutation({
    ...triggerCronJobMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cronJobsListQueryKey() });
      qc.invalidateQueries({ queryKey: cronJobRunsListQueryKey() });
    },
  });
}

/** Cancel (kill) the queued/running run of a job — the admin stop button. */
export function useCancelCronJob() {
  const qc = useQueryClient();
  return useMutation({
    ...cancelCronJobMutation(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cronJobsListQueryKey() });
      qc.invalidateQueries({ queryKey: cronJobRunsListQueryKey() });
    },
  });
}

// ─────────────────────────────────────────────────────────────
//  Users (admin role management — three-role model)
// ─────────────────────────────────────────────────────────────

/** One page of users + total for the admin Users table. */
export function useUsers(query?: { limit?: number; offset?: number }) {
  return useQuery({
    ...listUsersOptions({ query }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

/** Change a user's role (admin-only; backend enforces the permission). */
export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    ...setUserRoleMutation(),
    onSuccess: () => {
      // Refresh the users page (the changed row may reorder).
      qc.invalidateQueries({ queryKey: ["listUsers"] });
      // Role changes can flip what this account is allowed to see —
      // drop the cached /me so guards re-evaluate on next load.
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
