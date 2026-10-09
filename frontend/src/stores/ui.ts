import { create } from 'zustand'

export type ShareTrip = {
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
}

export type PriceAlertContext = { fromName: string; toName: string; minPrice: number }

/** Compared trip ids are capped so the tray stays readable. */
const MAX_COMPARE = 3

type UiState = {
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  callOpen: boolean
  setCallOpen: (open: boolean) => void
  notifOpen: boolean
  setNotifOpen: (open: boolean) => void
  loyaltyOpen: boolean
  setLoyaltyOpen: (open: boolean) => void

  compareList: string[]
  toggleCompare: (tripId: string) => void
  clearCompare: () => void
  compareOpen: boolean
  setCompareOpen: (open: boolean) => void

  /** The dialogs below are open exactly while their payload is set. */
  shareTrip: ShareTrip | null
  openShare: (trip: ShareTrip) => void
  closeShare: () => void
  cancelBookingId: string | null
  openCancel: (bookingId: string) => void
  closeCancel: () => void
  priceAlert: PriceAlertContext | null
  openPriceAlert: (context: PriceAlertContext) => void
  closePriceAlert: () => void
}

/** Transient overlay state (dialogs, panels) shared across the app shell. */
export const useUi = create<UiState>((set) => ({
  chatOpen: false,
  setChatOpen: (chatOpen) => set({ chatOpen }),
  callOpen: false,
  setCallOpen: (callOpen) => set({ callOpen }),
  notifOpen: false,
  setNotifOpen: (notifOpen) => set({ notifOpen }),
  loyaltyOpen: false,
  setLoyaltyOpen: (loyaltyOpen) => set({ loyaltyOpen }),

  compareList: [],
  toggleCompare: (tripId) =>
    set((s) => ({
      compareList: s.compareList.includes(tripId)
        ? s.compareList.filter((id) => id !== tripId)
        : [...s.compareList, tripId].slice(0, MAX_COMPARE),
    })),
  clearCompare: () => set({ compareList: [] }),
  compareOpen: false,
  setCompareOpen: (compareOpen) => set({ compareOpen }),

  shareTrip: null,
  openShare: (shareTrip) => set({ shareTrip }),
  closeShare: () => set({ shareTrip: null }),
  cancelBookingId: null,
  openCancel: (cancelBookingId) => set({ cancelBookingId }),
  closeCancel: () => set({ cancelBookingId: null }),
  priceAlert: null,
  openPriceAlert: (priceAlert) => set({ priceAlert }),
  closePriceAlert: () => set({ priceAlert: null }),
}))
