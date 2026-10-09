import { describe, expect, it } from 'vitest'
import type { TripSeat, TripSeatDeck } from '@/api'
import {
  blankPlan,
  cellAt,
  cloneDeckAbove,
  dropCell,
  mirrorDeck,
  moveCell,
  nextLabel,
  putCell,
  renumber,
  resizeDeck,
  sellableCount,
  toDeckViews,
  validatePlan,
  type DeckPlan,
  type SeatPlan,
} from '../model'

const seat = (row: number, col: number, label: string, kind: PlanKind = 'seat'): PlanCellInput => ({
  row,
  col,
  kind,
  label,
})
type PlanKind = DeckPlan['cells'][number]['kind']
type PlanCellInput = DeckPlan['cells'][number]

const deck = (rows: number, cols: number, cells: PlanCellInput[]): DeckPlan => ({
  rows,
  cols,
  cells,
})
const plan = (...decks: DeckPlan[]): SeatPlan => ({ decks })

const tripSeat = (partial: Partial<TripSeat> & Pick<TripSeat, 'id' | 'row' | 'col'>): TripSeat => ({
  code: partial.id,
  seatLabel: partial.id,
  deck: 1,
  status: 'available',
  finalPrice: 100000,
  ...partial,
})
const tripDeck = (seats: TripSeat[], extra: Partial<TripSeatDeck> = {}): TripSeatDeck => ({
  deck: 1,
  rows: [{ row: 1, seats }],
  ...extra,
})

describe('cell operations', () => {
  const base = deck(2, 3, [seat(1, 1, '01'), seat(1, 3, '02')])

  it('puts a cell, replacing the one already there', () => {
    const next = putCell(base, seat(1, 1, '09', 'bed'))
    expect(next.cells).toHaveLength(2)
    expect(cellAt(next, { row: 1, col: 1 })).toMatchObject({ kind: 'bed', label: '09' })
  })

  it('drops a cell', () => {
    expect(dropCell(base, { row: 1, col: 3 }).cells.map((c) => c.label)).toEqual(['01'])
  })

  it('moves a cell to an empty position and swaps with an occupied one', () => {
    const moved = moveCell(base, { row: 1, col: 1 }, { row: 2, col: 2 })
    expect(cellAt(moved, { row: 2, col: 2 })?.label).toBe('01')
    expect(cellAt(moved, { row: 1, col: 1 })).toBeUndefined()

    const swapped = moveCell(base, { row: 1, col: 1 }, { row: 1, col: 3 })
    expect(cellAt(swapped, { row: 1, col: 1 })?.label).toBe('02')
    expect(cellAt(swapped, { row: 1, col: 3 })?.label).toBe('01')
    // moving nothing is a no-op
    expect(moveCell(base, { row: 2, col: 2 }, { row: 1, col: 2 })).toBe(base)
  })

  it('resizes the grid and drops cells that fall outside', () => {
    const smaller = resizeDeck(base, 2, 2)
    expect(smaller.cells.map((c) => c.label)).toEqual(['01'])
    expect(resizeDeck(base, 99, 99)).toMatchObject({ rows: 30, cols: 9 })
    expect(resizeDeck(base, 0, 0)).toMatchObject({ rows: 1, cols: 1 })
  })

  it('mirrors a deck left to right', () => {
    const mirrored = mirrorDeck(base)
    expect(mirrored.cells.map((c) => [c.label, c.col])).toEqual([
      ['01', 3],
      ['02', 1],
    ])
  })
})

describe('labels', () => {
  it('continues the numbering used on the deck', () => {
    const p = plan(deck(3, 3, [seat(1, 1, 'A01', 'bed'), seat(1, 2, 'A09', 'bed')]))
    expect(nextLabel(p, 0)).toBe('A10')
  })

  it('starts a plain number on a single empty deck and a deck letter on two', () => {
    expect(nextLabel(plan(deck(1, 1, [])), 0)).toBe('01')
    const two = plan(deck(1, 1, []), deck(1, 1, []))
    expect(nextLabel(two, 0)).toBe('A01')
    expect(nextLabel(two, 1)).toBe('B01')
  })

  it('never reuses a taken label', () => {
    const p = plan(deck(1, 2, [seat(1, 1, '1')]))
    // width 2 → "02"; but "02" is free here, so take the next after max
    expect(nextLabel(p, 0)).toBe('02')
    const crowded = plan(deck(1, 3, [seat(1, 1, '01'), seat(1, 2, '02')]), deck(1, 1, [seat(1, 1, '03')]))
    expect(nextLabel(crowded, 0)).toBe('04')
  })

  it('renumbers in reading order: 01… on one deck, A01…/B01… on two', () => {
    const one = renumber(plan(deck(2, 2, [seat(2, 1, 'x'), seat(1, 2, 'y'), seat(1, 1, 'z')])))
    expect(one.decks[0].cells.map((c) => [c.row, c.col, c.label])).toEqual([
      [2, 1, '03'],
      [1, 2, '02'],
      [1, 1, '01'],
    ])
    const two = renumber(
      plan(deck(1, 2, [seat(1, 2, 'q'), seat(1, 1, 'w')]), deck(1, 1, [seat(1, 1, 'e')])),
    )
    expect(two.decks[0].cells.map((c) => c.label)).toEqual(['A02', 'A01'])
    expect(two.decks[1].cells.map((c) => c.label)).toEqual(['B01'])
  })

  it('keeps fixtures and seat ids while renumbering', () => {
    const p = plan(
      deck(1, 2, [
        { row: 1, col: 1, kind: 'driver' },
        { ...seat(1, 2, 'q'), seatId: 'id-1' },
      ]),
    )
    const [driver, s] = renumber(p).decks[0].cells
    expect(driver).toEqual({ row: 1, col: 1, kind: 'driver' })
    expect(s).toMatchObject({ label: '01', seatId: 'id-1' })
  })

  it('clones the lower deck into an upper one with fresh labels and no cab', () => {
    const lower = deck(2, 3, [
      { row: 1, col: 1, kind: 'driver' },
      { ...seat(2, 1, 'A01', 'bed'), seatId: 'id' },
      seat(2, 3, 'A02', 'bed'),
    ])
    const cloned = cloneDeckAbove(plan(lower))
    expect(cloned.decks).toHaveLength(2)
    expect(cloned.decks[1].cells).toEqual([
      { row: 2, col: 1, kind: 'bed', label: 'B01' },
      { row: 2, col: 3, kind: 'bed', label: 'B02' },
    ])
    expect(cloneDeckAbove(cloned)).toBe(cloned) // already two decks
  })
})

describe('validatePlan', () => {
  const codes = (p: SeatPlan) => validatePlan(p).map((i) => i.code)

  it('accepts a sound plan and the blank starting point once it has a seat', () => {
    expect(validatePlan(plan(deck(2, 2, [seat(1, 1, '01')])))).toEqual([])
    expect(codes(blankPlan())).toEqual(['noSeats'])
  })

  it('flags overlaps, out-of-grid cells, duplicate / missing labels and extra drivers', () => {
    expect(codes(plan(deck(1, 2, [seat(1, 1, '1'), seat(1, 1, '2')])))).toContain('overlap')
    expect(codes(plan(deck(1, 1, [seat(2, 1, '1')])))).toContain('outside')
    expect(codes(plan(deck(1, 2, [seat(1, 1, 'A1'), seat(1, 2, 'a1')])))).toContain('duplicate')
    expect(codes(plan(deck(1, 1, [seat(1, 1, '')])))).toContain('label')
    expect(codes(plan(deck(1, 1, [seat(1, 1, '12345678901')])))).toContain('label')
    const drivers = deck(1, 3, [
      { row: 1, col: 1, kind: 'driver' },
      { row: 1, col: 2, kind: 'driver' },
      seat(1, 3, '1'),
    ])
    expect(codes(plan(drivers))).toContain('drivers')
  })

  it('enforces the deck and seat limits', () => {
    const d = deck(1, 1, [seat(1, 1, '1')])
    expect(codes(plan(d, d, d))).toEqual(['decks'])
    expect(codes({ decks: [] })).toEqual(['decks'])
    const many = deck(
      14,
      9,
      Array.from({ length: 121 }, (_, i) => seat((i % 14) + 1, Math.floor(i / 14) + 1, `S${i}`)),
    )
    expect(codes(plan(many))).toContain('tooMany')
  })

  it('counts only sellable cells', () => {
    const p = plan(
      deck(1, 3, [{ row: 1, col: 1, kind: 'wc' }, seat(1, 2, '1'), seat(1, 3, '2', 'cabin')]),
    )
    expect(sellableCount(p)).toBe(2)
  })
})

describe('toDeckViews', () => {
  it('uses the saved frame when the trip carries one', () => {
    const views = toDeckViews([
      tripDeck([tripSeat({ id: 'a', row: 2, col: 1, kind: 'bed', seatClass: 'bed_lower' })], {
        plan: { rows: 3, cols: 5, fixtures: [{ row: 1, col: 1, kind: 'driver' }] },
      }),
    ])
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ deck: 1, rows: 3, cols: 5, berths: true })
    expect(views[0].fixtures).toHaveLength(1)
    expect(views[0].seats[0]).toMatchObject({ row: 2, col: 1 })
  })

  it('derives a frame for legacy layouts: cab row, aisle on 2+2 grids', () => {
    const [view] = toDeckViews([
      tripDeck([
        tripSeat({ id: 'A1', row: 1, col: 1 }),
        tripSeat({ id: 'B1', row: 1, col: 2 }),
        tripSeat({ id: 'C1', row: 1, col: 3 }),
        tripSeat({ id: 'D1', row: 1, col: 4 }),
      ]),
    ])
    expect(view).toMatchObject({ rows: 2, cols: 5, berths: false })
    expect(view.fixtures).toEqual([{ row: 1, col: 1, kind: 'driver' }])
    // seats move one row down (cab row) and C/D hop over the aisle column
    expect(view.seats.map((p) => [p.seat.id, p.row, p.col])).toEqual([
      ['A1', 2, 1],
      ['B1', 2, 2],
      ['C1', 2, 4],
      ['D1', 2, 5],
    ])
  })

  it('draws the driver on the lower deck only for legacy layouts', () => {
    const upper = toDeckViews([
      tripDeck([tripSeat({ id: 'B01', row: 1, col: 1, deck: 2, seatClass: 'bed_upper' })], {
        deck: 2,
      }),
    ])[0]
    expect(upper.fixtures).toEqual([])
    expect(upper.berths).toBe(true)
  })

  it('flows seats into rows of four when they carry no usable position', () => {
    const [view] = toDeckViews([
      tripDeck(
        Array.from({ length: 6 }, (_, i) => tripSeat({ id: `S${i + 1}`, row: 0, col: 0 })),
      ),
    ])
    expect(view.seats.map((p) => [p.row, p.col])).toEqual([
      [2, 1],
      [2, 2],
      [2, 4],
      [2, 5],
      [3, 1],
      [3, 2],
    ])
  })
})
