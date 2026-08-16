/**
 * Global app store (Zustand).
 *
 * SCOPE — what lives here vs. the router vs. TanStack Query:
 *
 *   • ROUTER owns:           the active URL/path, search-params for
 *                            `/search`, deep-link params like
 *                            `/trips/$tripId` and `/brands/$slug`.
 *                            (see src/router.tsx)
 *
 *   • TANSTACK QUERY owns:   all server state — brands, routes, trips,
 *                            bookings, reviews, notifications, etc.
 *                            (see src/lib/queries/index.ts)
 *
 *   • THIS STORE owns:       purely transient UI state that has no URL
 *                            representation — dialog open/close flags,
 *                            the booking-flow step machine, guest
 *                            profile (localStorage), language, currency,
 *                            and the authenticated user session cache.
 *
 * Anything that should survive a page reload via the URL is in the router.
 * Anything that should survive via the network is in TanStack Query.
 * Anything that should survive via localStorage is here.
 */

import { create } from 'zustand'

/** User role. 'guest' = not logged in, 'user' = regular customer, 'employee' = staff with dashboard access. */
export type UserRole = 'guest' | 'user' | 'employee'

export type Place = {
  id: string
  name: string
  type: string
  province: string | null
  lat: number
  lon: number
}

// ── Search params are now owned by the /search route's validateSearch.
// We keep the type here for components that need to read/write the
// search form state before navigation. ──
export type SearchParams = {
  from: string
  to: string
  date: string
  roundTrip: boolean
  returnDate: string
  adults: number
  children: number
  sort: 'departure' | 'price' | 'duration' | 'rating'
  vehicleTypes: string[]
}

// Re-export TripResult for backward compat with components that still
// import it from the store. New code should import from '@/lib/queries'.
export type { TripResult } from '@/lib/api/types.gen'

export type Campaign = {
  id: string
  code: string
  name: string
  type: string
  value: number
  scope: string
  minSubtotal: number
  maxDiscount: number
  description: string | null
  bannerColor: string
  brandId: string | null
}

type AppState = {
  // ── Search form state (drives the SearchWidget; the URL is the source
  // of truth once the user navigates to /search) ──
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void

  // ── Booking context (selected trip + seats + boarding/dropping) ──
  // Set by the trip detail page, consumed by the BookingDialog overlay.
  bookingContext: {
    tripId: string
    seatIds: string[]
    boardingPointId: string
    droppingPointId: string
  } | null
  setBookingContext: (c: AppState['bookingContext']) => void

  // ── Booking flow state machine ──
  bookingStep: 'idle' | 'passengers' | 'contact' | 'payment' | 'success'
  setBookingStep: (s: AppState['bookingStep']) => void
  lastBooking: { id: string; code: string; total: number } | null
  setLastBooking: (b: AppState['lastBooking']) => void

  // ── Chat overlay ──
  chatOpen: boolean
  setChatOpen: (b: boolean) => void
  chatUserId: string | null
  setChatUserId: (id: string | null) => void

  // ── Guest profile (persisted) ──
  guestPhone: string | null
  setGuestPhone: (p: string | null) => void
  guestName: string | null
  setGuestName: (n: string | null) => void

  // ── Recently viewed trips (persisted) ──
  recentlyViewed: { tripId: string; routeId: string; label: string; brandName: string; seenAt: number }[]
  pushRecentlyViewed: (r: { tripId: string; routeId: string; label: string; brandName: string }) => void

  // ── Compare list (in-memory) ──
  compareList: string[] // tripIds
  toggleCompare: (tripId: string) => void
  clearCompare: () => void
  compareOpen: boolean
  setCompareOpen: (b: boolean) => void

  // ── Notification panel ──
  notifOpen: boolean
  setNotifOpen: (b: boolean) => void

  // ── Wishlist panel ──
  wishlistOpen: boolean
  setWishlistOpen: (b: boolean) => void

  // ── Loyalty panel ──
  loyaltyOpen: boolean
  setLoyaltyOpen: (b: boolean) => void
  loyaltyPoints: number
  setLoyaltyPoints: (p: number | ((prev: number) => number)) => void

  // ── Insurance level in booking flow ──
  insuranceLevel: 'none' | 'basic' | 'comprehensive'
  setInsuranceLevel: (l: AppState['insuranceLevel']) => void

  // ── Language + currency (persisted) ──
  lang: 'vi' | 'en'
  setLang: (l: 'vi' | 'en') => void
  currency: 'VND' | 'USD'
  setCurrency: (c: 'VND' | 'USD') => void

  // ── Share dialog ──
  shareOpen: boolean
  setShareOpen: (b: boolean) => void
  shareTripData: {
    tripId: string
    code?: string
    fromName: string
    toName: string
    departureAt?: string
    departureTime?: string
    brandName: string
    brandAccent?: string
    brandRating?: number
    minPrice: number
    vehicleTypeLabel?: string
  } | null
  setShareTripData: (d: AppState['shareTripData']) => void

  // ── Cancel booking dialog ──
  cancelDialogOpen: boolean
  setCancelDialogOpen: (b: boolean) => void
  cancelBookingId: string | null
  setCancelBookingId: (id: string | null) => void

  // ── Price alert dialog ──
  priceAlertOpen: boolean
  setPriceAlertOpen: (b: boolean) => void
  priceAlertContext: { fromName: string; toName: string; minPrice: number } | null
  setPriceAlertContext: (c: AppState['priceAlertContext']) => void

  // ── Authenticated user (verified server-side via /api/auth/me). null = guest. ──
  user: {
    id: string
    type: 'user' | 'employee'
    role: 'user' | 'admin' | 'support_agent' | 'support_lead' | 'ops'
    name: string
    phone?: string | null
    email?: string | null
    avatarUrl?: string | null
    brandId?: string | null
    brandName?: string | null
    employeeRole?: string | null
  } | null
  setUser: (u: AppState['user']) => void

  // ── Auth dialog (login/OTP) open state ──
  authOpen: boolean
  setAuthOpen: (b: boolean) => void
}

const today = new Date()
const tomorrow = new Date(today)
tomorrow.setDate(tomorrow.getDate() + 1)
const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

// ─────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────
// IMPORTANT: The store initializes with server-safe defaults (null / [] / 'vi' / 'VND')
// so that SSR HTML matches the first client render (no hydration mismatch).
// localStorage values are loaded AFTER mount via `hydrateFromStorage()`.

/** Read persisted values from localStorage and push them into the store.
 *  Call this once in a top-level useEffect (client-only).
 *  NOTE: The `user` field is a fast-cache only — the authoritative source is the
 *  /api/auth/me query (`useAuthMe`), which the router's AuthBootstrap reconciles. */
export function hydrateFromStorage() {
  if (typeof window === 'undefined') return

  const chatUser = localStorage.getItem('bus_chat_user')
  const guestPhone = localStorage.getItem('bus_guest_phone')
  const guestName = localStorage.getItem('bus_guest_name')
  const lang = localStorage.getItem('bus_lang') === 'en' ? 'en' : 'vi'
  const currency = localStorage.getItem('bus_currency') === 'USD' ? 'USD' : 'VND'

  let recentlyViewed: { tripId: string; routeId: string; label: string; brandName: string; seenAt: number }[] = []
  try {
    const raw = localStorage.getItem('bus_recently_viewed')
    recentlyViewed = raw ? JSON.parse(raw) : []
  } catch {}

  let user: AppState['user'] = null
  try {
    const raw = localStorage.getItem('bus_user')
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed) {
      const type = parsed.type === 'employee' ? 'employee' : 'user'
      const role = parsed.type === 'employee' ? (parsed.employeeRole || 'support_agent') : (parsed.role || 'user')
      user = {
        id: parsed.id,
        type,
        role,
        name: parsed.name || 'Khách',
        phone: parsed.phone ?? null,
        email: parsed.email ?? null,
        avatarUrl: parsed.avatarUrl ?? null,
        brandId: parsed.brandId ?? null,
        brandName: parsed.brandName ?? null,
        employeeRole: parsed.employeeRole ?? null,
      }
    }
  } catch {}

  // Read search params from the URL if we're on /search — the router is
  // the source of truth there. Otherwise use defaults.
  let searchParams: SearchParams = {
    from: 'Hà Nội',
    to: 'Đà Nẵng',
    date: fmtDate(tomorrow),
    roundTrip: false,
    returnDate: '',
    adults: 1,
    children: 0,
    sort: 'departure',
    vehicleTypes: [],
  }
  try {
    if (window.location.pathname === '/search') {
      const sp = new URLSearchParams(window.location.search)
      const from = sp.get('from')
      const to = sp.get('to')
      const date = sp.get('date')
      const adults = sp.get('adults')
      const children = sp.get('children')
      const sort = sp.get('sort')
      const vt = sp.get('vt')
      const roundTrip = sp.get('roundTrip') === '1' || sp.get('roundTrip') === 'true'
      const returnDate = sp.get('returnDate')
      if (from) searchParams.from = from
      if (to) searchParams.to = to
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) searchParams.date = date
      if (adults) searchParams.adults = Math.max(1, parseInt(adults, 10) || 1)
      if (children) searchParams.children = Math.max(0, parseInt(children, 10) || 0)
      if (sort && ['departure', 'price', 'duration', 'rating'].includes(sort)) searchParams.sort = sort as SearchParams['sort']
      if (vt) searchParams.vehicleTypes = vt.split(',').map((s) => s.trim()).filter(Boolean)
      searchParams.roundTrip = roundTrip
      if (returnDate && /^\d{4}-\d{2}-\d{2}$/.test(returnDate)) searchParams.returnDate = returnDate
    } else {
      // Persisted search form state (so the widget remembers the last query)
      const raw = localStorage.getItem('bus_search_params')
      if (raw) {
        const parsed = JSON.parse(raw)
        searchParams = { ...searchParams, ...parsed }
      }
    }
  } catch {}

  useApp.setState({ chatUserId: chatUser, guestPhone, guestName, lang, currency, recentlyViewed, user, searchParams })
}

export const useApp = create<AppState>((set) => ({
  searchParams: {
    from: 'Hà Nội',
    to: 'Đà Nẵng',
    date: fmtDate(tomorrow),
    roundTrip: false,
    returnDate: '',
    adults: 1,
    children: 0,
    sort: 'departure',
    vehicleTypes: [],
  },
  setSearchParams: (p) =>
    set((s) => {
      const next = { ...s.searchParams, ...p }
      // Persist the search form so returning to the homepage keeps the
      // last-used values in the widget.
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('bus_search_params', JSON.stringify(next))
        }
      } catch {}
      return { searchParams: next }
    }),

  bookingContext: null,
  setBookingContext: (c) => set({ bookingContext: c }),

  bookingStep: 'idle',
  setBookingStep: (s) => set({ bookingStep: s }),
  lastBooking: null,
  setLastBooking: (b) => set({ lastBooking: b }),

  chatOpen: false,
  setChatOpen: (b) => set({ chatOpen: b }),
  chatUserId: null,
  setChatUserId: (id) => {
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('bus_chat_user', id)
      else localStorage.removeItem('bus_chat_user')
    }
    set({ chatUserId: id })
  },

  guestPhone: null,
  setGuestPhone: (p) => {
    if (typeof window !== 'undefined') {
      if (p) localStorage.setItem('bus_guest_phone', p)
      else localStorage.removeItem('bus_guest_phone')
    }
    set({ guestPhone: p })
  },
  guestName: null,
  setGuestName: (n) => {
    if (typeof window !== 'undefined') {
      if (n) localStorage.setItem('bus_guest_name', n)
      else localStorage.removeItem('bus_guest_name')
    }
    set({ guestName: n })
  },

  recentlyViewed: [],
  pushRecentlyViewed: (r) =>
    set((s) => {
      const filtered = s.recentlyViewed.filter((x) => x.tripId !== r.tripId)
      const next = [{ ...r, seenAt: Date.now() }, ...filtered].slice(0, 8)
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('bus_recently_viewed', JSON.stringify(next))
        } catch {}
      }
      return { recentlyViewed: next }
    }),

  compareList: [],
  toggleCompare: (tripId) =>
    set((s) => ({
      compareList: s.compareList.includes(tripId)
        ? s.compareList.filter((t) => t !== tripId)
        : [...s.compareList, tripId].slice(0, 3),
    })),
  clearCompare: () => set({ compareList: [] }),
  compareOpen: false,
  setCompareOpen: (b) => set({ compareOpen: b }),

  notifOpen: false,
  setNotifOpen: (b) => set({ notifOpen: b }),

  wishlistOpen: false,
  setWishlistOpen: (b) => set({ wishlistOpen: b }),

  loyaltyOpen: false,
  setLoyaltyOpen: (b) => set({ loyaltyOpen: b }),
  loyaltyPoints: 0,
  setLoyaltyPoints: (p) =>
    set((s) => ({
      loyaltyPoints: typeof p === 'function' ? p(s.loyaltyPoints) : p,
    })),

  insuranceLevel: 'none',
  setInsuranceLevel: (l) => set({ insuranceLevel: l }),

  lang: 'vi',
  setLang: (l) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('bus_lang', l)
    }
    set({ lang: l })
  },

  currency: 'VND',
  setCurrency: (c) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('bus_currency', c)
    }
    set({ currency: c })
  },

  shareOpen: false,
  setShareOpen: (b) => set({ shareOpen: b }),
  shareTripData: null,
  setShareTripData: (d) => set({ shareTripData: d }),

  cancelDialogOpen: false,
  setCancelDialogOpen: (b) => set({ cancelDialogOpen: b }),
  cancelBookingId: null,
  setCancelBookingId: (id) => set({ cancelBookingId: id }),

  priceAlertOpen: false,
  setPriceAlertOpen: (b) => set({ priceAlertOpen: b }),
  priceAlertContext: null,
  setPriceAlertContext: (c) => set({ priceAlertContext: c }),

  user: null,
  setUser: (u) => {
    if (typeof window !== 'undefined') {
      if (u) localStorage.setItem('bus_user', JSON.stringify(u))
      else localStorage.removeItem('bus_user')
    }
    set({ user: u })
  },

  authOpen: false,
  setAuthOpen: (b) => set({ authOpen: b }),
}))
