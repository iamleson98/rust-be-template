/**
 * SeatMap — the customer-facing seat picker. Covers honest price tags
 * (a surcharge over the cheapest available seat, never on the baseline /
 * booked / selected seats), selection state, and the plan-driven layout:
 * fixtures from the saved frame, seats placed by their own row/col.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { TripSeat, TripSeatDeck } from '@/api'
import { SeatMap } from '../seat-map'

function seat(
  partial: Partial<TripSeat> & Pick<TripSeat, 'id' | 'finalPrice' | 'status'>,
): TripSeat {
  return {
    code: partial.id,
    seatLabel: partial.id,
    deck: 1,
    row: 1,
    col: 1,
    seatClass: 'standard',
    ...partial,
  }
}

/** Legacy shape: no frame, seats only. */
const legacy: TripSeatDeck[] = [
  {
    deck: 1,
    rows: [
      {
        row: 1,
        seats: [
          seat({ id: 'A1', finalPrice: 200000, status: 'available', col: 1 }),
          seat({ id: 'A2', finalPrice: 250000, status: 'available', col: 2, seatClass: 'premium' }),
        ],
      },
      {
        row: 2,
        seats: [
          seat({ id: 'B1', finalPrice: 200000, status: 'booked', row: 2, col: 1 }),
          seat({
            id: 'B2',
            finalPrice: 300000,
            status: 'available',
            row: 2,
            col: 2,
            seatClass: 'vip',
          }),
        ],
      },
    ],
  },
]

const tags = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('span'))
    .filter((s) => /^\+\d/.test(s.textContent ?? ''))
    .map((s) => s.textContent)

describe('SeatMap', () => {
  const onToggleSeat = vi.fn()
  const props = { decks: legacy, selectedSeatIds: [] as string[], onToggleSeat, maxSeats: 2 }

  it('draws the driver and every seat of a legacy layout', () => {
    render(<SeatMap {...props} />)
    expect(screen.getByRole('img', { name: 'Tài xế' })).toBeInTheDocument()
    for (const code of ['A1', 'A2', 'B1', 'B2']) expect(screen.getByText(code)).toBeInTheDocument()
  })

  it('tags seats priced above the cheapest available seat with a surcharge', () => {
    const { container } = render(<SeatMap {...props} />)
    // A2 = +50k over the 200k baseline, B2 = +100k
    expect(tags(container)).toEqual(['+50k', '+100k'])
  })

  it('never tags the baseline seat, booked seats or the selected seat', () => {
    const { container } = render(<SeatMap {...props} selectedSeatIds={['A2']} />)
    expect(tags(container)).toEqual(['+100k'])
  })

  it('lists each seat class on the trip with its price, cheapest first', () => {
    render(<SeatMap {...props} />)
    const tiers = within(screen.getByRole('list', { name: 'Giá theo hạng ghế' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent?.replace(/\s+/g, ' '))
    expect(tiers).toEqual([
      expect.stringMatching(/^Thường\s?200\.000/),
      expect.stringMatching(/^Cao cấp\s?250\.000/),
      expect.stringMatching(/^VIP\s?300\.000/),
    ])
  })

  it('shows the price on a selected seat and the brand child rule', () => {
    render(
      <SeatMap
        {...props}
        selectedSeatIds={['B2']}
        childFare={{ maxAge: 10, discountPercent: 25 }}
      />,
    )
    expect(screen.getByRole('button', { name: /B2/ })).toHaveTextContent('B2300k')
    expect(screen.getByText('Trẻ em đến 10 tuổi giảm 25%')).toBeInTheDocument()
  })

  it('marks selected seats with aria-pressed and reports the clicked seat', () => {
    render(<SeatMap {...props} selectedSeatIds={['A1']} />)
    const a1 = screen.getByRole('button', { name: /A1/ })
    expect(a1).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /B2/ }))
    expect(onToggleSeat).toHaveBeenCalledWith(expect.objectContaining({ id: 'B2' }))
  })

  it('disables booked seats and, once the limit is reached, unselected ones', () => {
    render(<SeatMap {...props} selectedSeatIds={['A1', 'A2']} />)
    expect(screen.getByRole('button', { name: /B1/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /B2/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /A1/ })).toBeEnabled()
  })

  it('places seats by their own row/col on a saved plan and draws its fixtures', () => {
    const planned: TripSeatDeck[] = [
      {
        deck: 1,
        plan: {
          rows: 3,
          cols: 5,
          fixtures: [
            { row: 1, col: 1, kind: 'driver' },
            { row: 1, col: 5, kind: 'door' },
          ],
        },
        rows: [
          {
            row: 2,
            seats: [
              seat({ id: 'A01', finalPrice: 1, status: 'available', row: 2, col: 1, kind: 'bed' }),
              seat({ id: 'A02', finalPrice: 1, status: 'available', row: 2, col: 5, kind: 'bed' }),
            ],
          },
        ],
      },
    ]
    render(<SeatMap decks={planned} selectedSeatIds={[]} onToggleSeat={onToggleSeat} />)
    expect(screen.getByRole('img', { name: 'Cửa lên xuống' })).toBeInTheDocument()
    const left = screen.getByRole('button', { name: /A01/ }).parentElement as HTMLElement
    const right = screen.getByRole('button', { name: /A02/ }).parentElement as HTMLElement
    expect([left.style.gridRow, left.style.gridColumn]).toEqual(['2', '1'])
    expect([right.style.gridRow, right.style.gridColumn]).toEqual(['2', '5'])
  })

  it('titles each deck when the vehicle has two', () => {
    const two: TripSeatDeck[] = [
      { ...legacy[0], deck: 1 },
      {
        deck: 2,
        rows: [
          { row: 1, seats: [seat({ id: 'U1', finalPrice: 1, status: 'available', deck: 2 })] },
        ],
      },
    ]
    render(<SeatMap decks={two} selectedSeatIds={[]} onToggleSeat={onToggleSeat} />)
    expect(screen.getByText('Tầng dưới')).toBeInTheDocument()
    expect(screen.getByText('Tầng trên')).toBeInTheDocument()
  })
})
