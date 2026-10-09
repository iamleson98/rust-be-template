import { create } from 'zustand'
import { storage } from './storage'

export type RecentTrip = {
  tripId: string
  routeId: string
  label: string
  brandName: string
  seenAt: number
}

const MAX_RECENT = 8

type GuestState = {
  /** Identity used by the support chat before sign-in. */
  chatUserId: string | null
  setChatUserId: (id: string | null) => void
  guestPhone: string | null
  setGuestPhone: (phone: string | null) => void
  guestName: string | null
  setGuestName: (name: string | null) => void
  recentlyViewed: RecentTrip[]
  pushRecentlyViewed: (trip: Omit<RecentTrip, 'seenAt'>) => void
}

/** Persisted visitor profile and browsing history. */
export const useGuest = create<GuestState>((set) => ({
  chatUserId: storage.get('bus_chat_user'),
  setChatUserId: (chatUserId) => {
    storage.set('bus_chat_user', chatUserId)
    set({ chatUserId })
  },
  guestPhone: storage.get('bus_guest_phone'),
  setGuestPhone: (guestPhone) => {
    storage.set('bus_guest_phone', guestPhone)
    set({ guestPhone })
  },
  guestName: storage.get('bus_guest_name'),
  setGuestName: (guestName) => {
    storage.set('bus_guest_name', guestName)
    set({ guestName })
  },
  recentlyViewed: storage.getJson<RecentTrip[]>('bus_recently_viewed', []),
  pushRecentlyViewed: (trip) =>
    set((s) => {
      const recentlyViewed = [
        { ...trip, seenAt: Date.now() },
        ...s.recentlyViewed.filter((r) => r.tripId !== trip.tripId),
      ].slice(0, MAX_RECENT)
      storage.setJson('bus_recently_viewed', recentlyViewed)
      return { recentlyViewed }
    }),
}))
