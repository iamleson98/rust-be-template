/**
 * Tests for the SeatMap component — focused on the honest price-difference
 * tags: available seats priced above the trip's cheapest available seat
 * get a "+XXk" corner tag; seats at the baseline (and non-available
 * seats) never do.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeatMap, type SeatInv } from '@/features/trips/seat-map'

function seat(partial: Partial<SeatInv> & Pick<SeatInv, 'id' | 'code' | 'finalPrice' | 'status'>): SeatInv {
  return {
    deck: 1,
    row: 1,
    col: 1,
    seatClass: 'standard',
    amenities: '',
    ...partial,
  }
}

const decks = [
  {
    deck: 1,
    rows: [
      {
        row: 1,
        seats: [
          seat({ id: 'A1', code: 'A1', finalPrice: 200000, status: 'available' }),
          seat({ id: 'A2', code: 'A2', finalPrice: 250000, status: 'available', seatClass: 'premium' }),
          null,
        ],
      },
      {
        row: 2,
        seats: [
          seat({ id: 'B1', code: 'B1', finalPrice: 200000, status: 'booked' }),
          seat({ id: 'B2', code: 'B2', finalPrice: 300000, status: 'available', seatClass: 'vip' }),
          null,
        ],
      },
    ],
  },
]

describe('SeatMap', () => {
  const onToggleSeat = vi.fn()

  it('renders the driver marker and deck rows', () => {
    render(<SeatMap decks={decks} selectedSeatIds={[]} onToggleSeat={onToggleSeat} maxSeats={2} />)
    expect(screen.getByText('Tài xế')).toBeInTheDocument()
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.getByText('A2')).toBeInTheDocument()
    expect(screen.getByText('B2')).toBeInTheDocument()
  })

  it('tags seats priced above the cheapest available seat with a surcharge', () => {
    const { container } = render(
      <SeatMap decks={decks} selectedSeatIds={[]} onToggleSeat={onToggleSeat} maxSeats={2} />,
    )
    const tags = Array.from(container.querySelectorAll('span')).filter((s) => /^\+\d/.test(s.textContent ?? ''))
    // A2 = +50k over the 200k baseline, B2 = +100k → two tags.
    expect(tags.map((s) => s.textContent)).toEqual(['+50k', '+100k'])
  })

  it('never tags the baseline seat, booked seats or the selected seat', () => {
    const { container } = render(
      <SeatMap decks={decks} selectedSeatIds={['A2']} onToggleSeat={onToggleSeat} maxSeats={2} />,
    )
    const tags = Array.from(container.querySelectorAll('span')).filter((s) => /^\+\d/.test(s.textContent ?? ''))
    // A2 is selected → its +50k tag is suppressed; only B2's +100k remains.
    expect(tags.map((s) => s.textContent)).toEqual(['+100k'])
  })

  it('shows the base price in the legend (cheapest available seat)', () => {
    render(<SeatMap decks={decks} selectedSeatIds={[]} onToggleSeat={onToggleSeat} maxSeats={2} />)
    expect(screen.getByText('Giá gốc:')).toBeInTheDocument()
    expect(screen.getByText(/200\.000/)).toBeInTheDocument()
  })

  it('marks selected seats with aria-pressed', () => {
    render(<SeatMap decks={decks} selectedSeatIds={['A1']} onToggleSeat={onToggleSeat} maxSeats={2} />)
    const a1 = screen.getByRole('button', { name: /A1/ })
    expect(a1).toHaveAttribute('aria-pressed', 'true')
  })
})
