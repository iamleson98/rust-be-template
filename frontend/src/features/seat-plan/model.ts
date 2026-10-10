/**
 * Seat-plan model — the physical floor plan of a vehicle (see
 * `dto/seat_plan.rs`). One uniform grid per deck: row 1 is the front,
 * column 1 the driver's side. An unoccupied cell is an aisle or a gap.
 *
 * Everything here is pure: the editor reducer, the validation that
 * mirrors the backend, and the trip-detail → drawable-deck conversion.
 */
import type { CellKind, DeckPlan, PlanCell, SeatPlan, TripSeat, TripSeatDeck } from '@/api'

export type { CellKind, DeckPlan, PlanCell, SeatPlan }

/** Mirrors `service/seat_plan.rs` — the server is the authority. */
export const LIMITS = { decks: 2, rows: 30, cols: 9, seats: 120, labelChars: 10 } as const

export const SELLABLE_KINDS: readonly CellKind[] = ['seat', 'bed', 'cabin', 'cabin_double']
export const FIXTURE_KINDS: readonly CellKind[] = ['driver', 'door', 'stairs', 'wc']

const SELLABLE = new Set<CellKind>(SELLABLE_KINDS)
const BERTH = new Set<CellKind>(['bed', 'cabin', 'cabin_double'])

export const isSellable = (kind: CellKind) => SELLABLE.has(kind)
/** Lies along the vehicle (taller tile): berths and cabins. */
export const isBerth = (kind: CellKind) => BERTH.has(kind)

export type Pos = { row: number; col: number }

export const sellableCount = (plan: SeatPlan) =>
  plan.decks.reduce((n, d) => n + d.cells.filter((c) => isSellable(c.kind)).length, 0)

export const cellAt = (deck: DeckPlan, { row, col }: Pos) =>
  deck.cells.find((c) => c.row === row && c.col === col)

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(n)))

// ── editing ──────────────────────────────────────────────────

const withCells = (deck: DeckPlan, cells: PlanCell[]): DeckPlan => ({ ...deck, cells })

/** Place `cell`, replacing whatever sits at its position. */
export const putCell = (deck: DeckPlan, cell: PlanCell): DeckPlan =>
  withCells(deck, [...deck.cells.filter((c) => c.row !== cell.row || c.col !== cell.col), cell])

export const dropCell = (deck: DeckPlan, { row, col }: Pos): DeckPlan =>
  withCells(
    deck,
    deck.cells.filter((c) => c.row !== row || c.col !== col),
  )

/** Move a cell; an occupied target swaps places with it. */
export function moveCell(deck: DeckPlan, from: Pos, to: Pos): DeckPlan {
  const a = cellAt(deck, from)
  if (!a || (from.row === to.row && from.col === to.col)) return deck
  const b = cellAt(deck, to)
  return withCells(
    deck,
    deck.cells.map((c) => {
      if (c === a) return { ...c, ...to }
      if (c === b) return { ...c, ...from }
      return c
    }),
  )
}

/** Resize the grid, dropping cells that fall outside. */
export const resizeDeck = (deck: DeckPlan, rows: number, cols: number): DeckPlan => {
  const r = clamp(rows, 1, LIMITS.rows)
  const c = clamp(cols, 1, LIMITS.cols)
  return {
    ...deck,
    rows: r,
    cols: c,
    cells: deck.cells.filter((cell) => cell.row <= r && cell.col <= c),
  }
}

/** Mirror a deck left ↔ right (a left-hand-drive plan becomes right-hand). */
export const mirrorDeck = (deck: DeckPlan): DeckPlan =>
  withCells(
    deck,
    deck.cells.map((c) => ({ ...c, col: deck.cols + 1 - c.col })),
  )

const LABEL = /^([A-Za-z]*)(\d+)$/

/** The next free label for a new sellable cell on `deckIndex`, following
 *  the numbering already used on that deck (`A07` → `A08`, `12` → `13`). */
export function nextLabel(plan: SeatPlan, deckIndex: number): string {
  const taken = new Set(
    plan.decks.flatMap((d) => d.cells.map((c) => c.label?.trim().toLowerCase()).filter(Boolean)),
  )
  const parts = (plan.decks[deckIndex]?.cells ?? [])
    .filter((c) => isSellable(c.kind))
    .map((c) => LABEL.exec(c.label?.trim() ?? ''))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ prefix: m[1], n: Number(m[2]), width: m[2].length }))
  const prefix = parts[0]?.prefix ?? (plan.decks.length > 1 ? 'AB'[deckIndex] : '')
  const same = parts.filter((p) => p.prefix === prefix)
  const width = Math.max(2, ...same.map((p) => p.width))
  let n = Math.max(0, ...same.map((p) => p.n)) + 1
  while (taken.has(`${prefix}${String(n).padStart(width, '0')}`.toLowerCase())) n++
  return `${prefix}${String(n).padStart(width, '0')}`
}

/** Relabel every sellable cell in reading order: `01…` on one deck,
 *  `A01…` / `B01…` on two. Seat ids (identity) are kept. */
export function renumber(plan: SeatPlan): SeatPlan {
  const lettered = plan.decks.length > 1
  return {
    decks: plan.decks.map((deck, i) => {
      const order = deck.cells
        .filter((c) => isSellable(c.kind))
        .sort((a, b) => a.row - b.row || a.col - b.col)
      const labels = new Map(
        order.map((c, n) => [c, `${lettered ? 'AB'[i] : ''}${String(n + 1).padStart(2, '0')}`]),
      )
      return withCells(
        deck,
        deck.cells.map((c) => (labels.has(c) ? { ...c, label: labels.get(c) } : c)),
      )
    }),
  }
}

/** A new deck cloned from `source`: same berths, fresh labels, no cab. */
export function cloneDeckAbove(plan: SeatPlan): SeatPlan {
  const lower = plan.decks[0]
  if (!lower || plan.decks.length >= LIMITS.decks) return plan
  const upper: DeckPlan = {
    ...lower,
    name: null,
    cells: lower.cells
      .filter((c) => isSellable(c.kind))
      .map(({ seatId: _id, ...c }) => ({ ...c, label: null })),
  }
  return renumber({ decks: [lower, upper] })
}

export const blankPlan = (): SeatPlan => ({
  decks: [
    {
      rows: 8,
      cols: 5,
      cells: [
        { row: 1, col: 1, kind: 'driver' },
        { row: 1, col: 5, kind: 'door' },
      ],
    },
  ],
})

// ── validation (mirrors the backend; messages are i18n keys) ──

export type PlanIssueCode =
  | 'decks'
  | 'size'
  | 'outside'
  | 'overlap'
  | 'label'
  | 'duplicate'
  | 'drivers'
  | 'noSeats'
  | 'tooMany'

export type PlanIssue = { code: PlanIssueCode; params?: Record<string, string | number> }

export function validatePlan(plan: SeatPlan): PlanIssue[] {
  const issues: PlanIssue[] = []
  if (plan.decks.length < 1 || plan.decks.length > LIMITS.decks) {
    return [{ code: 'decks', params: { max: LIMITS.decks } }]
  }
  const labels = new Set<string>()
  let sellable = 0
  plan.decks.forEach((deck, i) => {
    const n = i + 1
    if (deck.rows < 1 || deck.rows > LIMITS.rows || deck.cols < 1 || deck.cols > LIMITS.cols) {
      issues.push({ code: 'size', params: { deck: n, rows: LIMITS.rows, cols: LIMITS.cols } })
    }
    const seen = new Set<string>()
    let drivers = 0
    for (const c of deck.cells) {
      const at = { deck: n, row: c.row, col: c.col }
      if (c.row < 1 || c.row > deck.rows || c.col < 1 || c.col > deck.cols) {
        issues.push({ code: 'outside', params: at })
      }
      if (seen.has(`${c.row}:${c.col}`)) issues.push({ code: 'overlap', params: at })
      seen.add(`${c.row}:${c.col}`)
      if (c.kind === 'driver') drivers++
      if (!isSellable(c.kind)) continue
      sellable++
      const label = c.label?.trim() ?? ''
      if (!label || label.length > LIMITS.labelChars) {
        issues.push({ code: 'label', params: { ...at, max: LIMITS.labelChars } })
      } else if (labels.has(label.toLowerCase())) {
        issues.push({ code: 'duplicate', params: { label } })
      }
      labels.add(label.toLowerCase())
    }
    if (drivers > 1) issues.push({ code: 'drivers', params: { deck: n } })
  })
  if (sellable === 0) issues.push({ code: 'noSeats' })
  if (sellable > LIMITS.seats) issues.push({ code: 'tooMany', params: { max: LIMITS.seats } })
  return issues
}

// ── trip detail → drawable decks ─────────────────────────────

export type PlacedSeat = { seat: TripSeat; row: number; col: number }

export type DeckView = {
  /** 1-based, as on the wire. */
  deck: number
  name?: string | null
  rows: number
  cols: number
  fixtures: PlanCell[]
  seats: PlacedSeat[]
  /** Any berth/cabin on the deck → taller tiles. */
  berths: boolean
}

const byLabel = (a: TripSeat, b: TripSeat) =>
  a.seatLabel.localeCompare(b.seatLabel, undefined, { numeric: true })

const hasUsablePositions = (seats: TripSeat[]) =>
  seats.every((s) => s.row >= 1 && s.col >= 1) &&
  new Set(seats.map((s) => `${s.row}:${s.col}`)).size === seats.length

/**
 * Layouts that predate seat plans carry no frame: derive one from the
 * seats' own row/col (four to a row when they have none), add a cab row
 * with the driver on the lower deck, and the usual aisle on 2+2 grids.
 */
function legacyDeck(deck: number, seats: TripSeat[]): DeckView {
  const sorted = [...seats].sort(byLabel)
  const placed = hasUsablePositions(seats)
    ? seats.map((seat) => ({ seat, row: seat.row, col: seat.col }))
    : sorted.map((seat, i) => ({ seat, row: Math.floor(i / 4) + 1, col: (i % 4) + 1 }))
  const width = Math.max(1, ...placed.map((p) => p.col))
  const aisle = width === 4
  return {
    deck,
    rows: Math.max(1, ...placed.map((p) => p.row)) + 1,
    cols: aisle ? 5 : width,
    fixtures: deck === 1 ? [{ row: 1, col: 1, kind: 'driver' }] : [],
    seats: placed.map((p) => ({
      seat: p.seat,
      row: p.row + 1,
      col: aisle && p.col > 2 ? p.col + 1 : p.col,
    })),
    berths: seats.some((s) => s.seatClass?.startsWith('bed_')),
  }
}

export function toDeckViews(decks: readonly TripSeatDeck[]): DeckView[] {
  return decks.map((d) => {
    const seats = d.rows.flatMap((r) => r.seats)
    if (!d.plan) return legacyDeck(d.deck, seats)
    return {
      deck: d.deck,
      name: d.plan.name,
      rows: d.plan.rows,
      cols: d.plan.cols,
      fixtures: d.plan.fixtures,
      seats: seats.map((seat) => ({ seat, row: seat.row, col: seat.col })),
      berths: seats.some((s) => s.kind && isBerth(s.kind)),
    }
  })
}
