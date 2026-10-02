/**
 * Tests for the TripCardPrice component.
 *
 * The honesty rules are asserted explicitly:
 *   - NO fabricated strikethrough "original" price (the old component
 *     invented `minPrice * 1.15`).
 *   - NO fake price-trend indicator (the old component derived a trend
 *     from a tripId hash).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripCardPrice } from '@/features/search/trip-card-price'
import type { TripResult } from '@/lib/store'

const baseTrip = {
  amenities: [],
  availableSeats: 12,
  brandAccent: '#2563eb',
  brandName: 'Phương Trang',
  brandRating: 4.5,
  brandSlug: 'phuong-trang',
  departureDate: '2026-10-05',
  departureTime: '08:30',
  fromLat: 10.76,
  fromLon: 106.66,
  fromName: 'TP.HCM',
  maxPrice: 350000,
  minPrice: 350000,
  priceAdult: 350000,
  priceChild: 175000,
  routeId: 'r1',
  routeName: 'TP.HCM - Đà Lạt',
  scheduleId: 's1',
  status: 'scheduled',
  toLat: 11.94,
  toLon: 108.44,
  toName: 'Đà Lạt',
  totalSeats: 40,
  tripId: 't1',
  vehicleType: 'limousine',
  vehicleTypeLabel: 'Limousine',
} satisfies TripResult

describe('TripCardPrice', () => {
  const baseProps = {
    trip: baseTrip,
    sellingFast: false,
    currency: 'VND' as const,
    onSelect: vi.fn(),
    onPriceAlert: vi.fn(),
  }

  it('renders the real per-seat price', () => {
    render(<TripCardPrice {...baseProps} />)
    expect(screen.getByText(/350\.000/)).toBeInTheDocument()
    expect(screen.getByText('/ghế')).toBeInTheDocument()
  })

  it('does NOT render a fabricated strikethrough original price', () => {
    const { container } = render(<TripCardPrice {...baseProps} />)
    // The old component invented minPrice * 1.15 = 402.500 and crossed it out.
    expect(screen.queryByText(/402\.500/)).not.toBeInTheDocument()
    expect(container.querySelector('.line-through')).toBeNull()
  })

  it('does NOT render a fake price-trend indicator', () => {
    const { container } = render(<TripCardPrice {...baseProps} />)
    // Trend icons were Tooltip-wrapped spans with trend color classes.
    expect(container.querySelector('.text-rose-500')).toBeNull()
    expect(container.querySelector('.text-blue-500')).toBeNull()
    expect(container.querySelector('.text-slate-400')).toBeNull()
  })

  it('shows the seats-left warning only when seats are genuinely low', () => {
    const { rerender } = render(<TripCardPrice {...baseProps} sellingFast />)
    expect(screen.getByText('Bán nhanh')).toBeInTheDocument()
    rerender(<TripCardPrice {...baseProps} sellingFast={false} />)
    expect(screen.queryByText('Bán nhanh')).not.toBeInTheDocument()
  })

  it('fires onSelect when the select-trip button is clicked', () => {
    const onSelect = vi.fn()
    render(<TripCardPrice {...baseProps} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /Chọn chuyến/i }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('fires onPriceAlert when the track-price link is clicked', () => {
    const onPriceAlert = vi.fn()
    render(<TripCardPrice {...baseProps} onPriceAlert={onPriceAlert} />)
    fireEvent.click(screen.getByText('Theo dõi giá'))
    expect(onPriceAlert).toHaveBeenCalledTimes(1)
  })

  it('shows the "from" hint when the backend reports a real price range', () => {
    render(
      <TripCardPrice
        {...baseProps}
        trip={{ ...baseTrip, maxPrice: 450000 }}
      />,
    )
    expect(screen.getByText('từ /ghế')).toBeInTheDocument()
  })
})
