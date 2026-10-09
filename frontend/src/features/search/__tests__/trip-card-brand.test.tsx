/**
 * Tests for the TripCardBrand component.
 *
 * Honesty rule asserted explicitly: the REAL rating is shown (4.5/5) and
 * NO fabricated review count is rendered next to it (the old component
 * computed `rating * 250` and formatted it as "1.1k").
 */
import type { TripResult } from '@/api'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripCardBrand } from '@/features/search/trip-card-brand'

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

describe('TripCardBrand', () => {
  const onBrandClick = vi.fn()

  it('renders the brand name and vehicle type label', () => {
    render(<TripCardBrand trip={baseTrip} onBrandClick={onBrandClick} />)
    expect(screen.getByText('Phương Trang')).toBeInTheDocument()
    expect(screen.getByText('Limousine')).toBeInTheDocument()
  })

  it('renders the real rating with a /5 scale', () => {
    render(<TripCardBrand trip={baseTrip} onBrandClick={onBrandClick} />)
    expect(screen.getByText('4.5')).toBeInTheDocument()
    expect(screen.getByText('/ 5')).toBeInTheDocument()
  })

  it('does NOT render a fabricated review count', () => {
    // Old component: rating * 250 = 1125 → "1.1k" in parentheses.
    render(<TripCardBrand trip={baseTrip} onBrandClick={onBrandClick} />)
    expect(screen.queryByText(/1\.1k/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/đánh giá/i)).not.toBeInTheDocument()
  })

  it('uses the brand accent color for the avatar', () => {
    const { container } = render(<TripCardBrand trip={baseTrip} onBrandClick={onBrandClick} />)
    // jsdom normalizes the hex color to rgb() — match on the inline
    // background style instead.
    const avatar = container.querySelector<HTMLElement>('[style*="background"]')
    expect(avatar).not.toBeNull()
    expect(avatar?.style.background).toMatch(/rgb\(37,\s*99,\s*235\)|#2563eb/)
    expect(avatar?.textContent).toBe('PT')
  })

  it('fires onBrandClick when the brand name is clicked', () => {
    render(<TripCardBrand trip={baseTrip} onBrandClick={onBrandClick} />)
    fireEvent.click(screen.getByText('Phương Trang'))
    expect(onBrandClick).toHaveBeenCalled()
  })
})
