// ── Types ───────────────────────────────────────────────────

export type Seat = {
  id: string
  code: string
  row: number
  col: number
  deck: number
  seatClass: string
  priceMultiplier: number
  status: string
  finalPrice: number
}

export type Passenger = {
  seatId: string
  seatCode: string
  name: string
  type: 'adult' | 'child' | 'infant'
  age: number
}

export type Step = 'search' | 'seats' | 'passenger' | 'confirm'
