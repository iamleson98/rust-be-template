import { create } from 'zustand'

export type BookingStep = 'idle' | 'passengers' | 'contact' | 'payment' | 'pay' | 'success'

export type BookingContext = {
  tripId: string
  seatIds: string[]
  boardingPointId: string
  droppingPointId: string
}

type BookingFlowState = {
  /** Trip + seats + stops chosen on the trip detail, consumed by the checkout. */
  context: BookingContext | null
  setContext: (context: BookingContext | null) => void
  /** `pay` = online-payment step (gateway redirect / QR + status polling). */
  step: BookingStep
  setStep: (step: BookingStep) => void
  lastBooking: { id: string; code: string; total: number } | null
  setLastBooking: (booking: BookingFlowState['lastBooking']) => void
}

export const useBookingFlow = create<BookingFlowState>((set) => ({
  context: null,
  setContext: (context) => set({ context }),
  step: 'idle',
  setStep: (step) => set({ step }),
  lastBooking: null,
  setLastBooking: (lastBooking) => set({ lastBooking }),
}))
