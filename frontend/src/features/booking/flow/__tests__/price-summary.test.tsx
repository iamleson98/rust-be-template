import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceSummary } from '@/features/booking/flow/price-summary'
import type { Ticket } from '@/features/booking/flow/use-booking-form'

const ticket = (code: string, type: Ticket['type'], price: number): Ticket => ({
  seat: { id: code, code, class: 'vip', price: 400_000, childPrice: 300_000 },
  passengerIndex: 0,
  passenger: undefined,
  type,
  price,
})

describe('PriceSummary', () => {
  const tickets = [ticket('A01', 'adult', 400_000), ticket('A02', 'child', 300_000)]

  it('lists every ticket at its own price and the total', () => {
    render(<PriceSummary tickets={tickets} discount={0} total={700_000} />)
    expect(screen.getByText('A01')).toBeInTheDocument()
    expect(screen.getByText(/400\.000/)).toBeInTheDocument()
    expect(screen.getByText(/300\.000/)).toBeInTheDocument()
    expect(screen.getByText(/700\.000/)).toBeInTheDocument()
  })

  it('hides the discount line when there is none', () => {
    render(<PriceSummary tickets={tickets} discount={0} total={700_000} />)
    expect(screen.queryByText(/^-/)).toBeNull()
  })

  it('shows the coupon discount with its code', () => {
    render(
      <PriceSummary tickets={tickets} couponCode="DXV7K2M9PQ" discount={30_000} total={670_000} />,
    )
    expect(screen.getByText('Giảm giá (DXV7K2M9PQ)')).toBeInTheDocument()
    expect(screen.getByText(/30\.000/)).toBeInTheDocument()
  })
})
