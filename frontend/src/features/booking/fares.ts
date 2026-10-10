import type { ChildFarePolicy } from '@/api'

/**
 * Ticket prices as the server computes them (`service/fares.rs`): a passenger is a
 * child when the brand sells child tickets and their age is within its limit, and
 * then pays the seat's child price. The server decides; this only shows it ahead.
 */

export type PassengerType = 'adult' | 'child'

/** A seat's prices: `childPrice` is absent when the brand has no child tickets. */
export type SeatPrices = { price: number; childPrice?: number | null }

export function passengerType(
  age: number,
  childFare: ChildFarePolicy | null | undefined,
): PassengerType {
  return childFare && age <= childFare.maxAge ? 'child' : 'adult'
}

export function ticketPrice(seat: SeatPrices, type: PassengerType): number {
  return type === 'child' && seat.childPrice != null ? seat.childPrice : seat.price
}
