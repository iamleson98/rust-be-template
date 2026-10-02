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
    campaignCode: '',
    discount: 0,
    fees: 0,
    total: 300000,
    currency: 'VND' as const,
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
    render(
      <PriceSummary
        {...baseProps}
        campaignCode="TET2025"
        discount={30000}
        total={270000}
      />,
    )
    // The discount amount should appear somewhere
    expect(screen.getByText(/30\.000/)).toBeInTheDocument()
  })

  it('hides the service-fees row when fees are 0 (no permanent 0₫ noise)', () => {
    render(<PriceSummary {...baseProps} />)
    expect(screen.queryByText(/phí dịch vụ/i)).toBeNull()
  })

  it('shows the service-fees row when fees > 0', () => {
    render(
      <PriceSummary
        {...baseProps}
        fees={10000}
        total={310000}
      />,
    )
    expect(screen.getByText(/phí dịch vụ/i)).toBeInTheDocument()
    // NB: 310.000 also contains "10.000" — assert on the exact fee cell.
    expect(screen.getByText(/^10\.000 ₫$/)).toBeInTheDocument()
  })
})
