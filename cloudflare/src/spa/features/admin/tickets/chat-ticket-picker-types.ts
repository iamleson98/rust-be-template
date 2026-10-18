// ── Types ───────────────────────────────────────────────────

export type Seat = {
  id: string
  code: string
  row: number
  col: number
  deck: number
  seatClass: string
  status: string
  finalPrice: number
  /** Absent when the brand has no child tickets. */
  childPrice?: number | null
}

export type Passenger = {
  seatId: string
  seatCode: string
  name: string
  type: 'adult' | 'child'
}

export type Step = 'search' | 'seats' | 'passenger' | 'confirm'
