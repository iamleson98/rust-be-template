/**
 * Tests for the PriceSummary component — the price-breakdown box.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceSummary } from '@/features/booking/flow/price-summary'

describe('PriceSummary', () => {
  const baseProps = {
    seatCount: 2,
    subtotal: 300000,
    discount: 0,
    total: 300000,
  }

  it('renders subtotal and total', () => {
    render(<PriceSummary {...baseProps} />)
    // The amount 300.000 appears in both subtotal and total
    const matches = screen.getAllByText(/300\.000/)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('hides discount when 0', () => {
    render(<PriceSummary {...baseProps} />)
    expect(screen.queryByText(/khuyến mãi/i)).toBeNull()
  })

  it('shows discount when > 0', () => {
    render(<PriceSummary {...baseProps} promoCode="TET2025" discount={30000} total={270000} />)
    // The discount amount should appear somewhere
    expect(screen.getByText(/30\.000/)).toBeInTheDocument()
  })
})
