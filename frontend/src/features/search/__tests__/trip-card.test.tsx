import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { TripResult } from '@/api'
import { TripCard } from '../trip-card'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => (
    <a {...(props as object)}>{children}</a>
  ),
}))

const trip: TripResult = {
  tripId: 't1',
  scheduleId: 's1',
  routeId: 'r1',
  routeName: 'HCM - CT',
  brandName: 'Phuong Trang',
  brandSlug: 'phuong-trang',
  brandAccent: '#f97316',
  brandRating: 4.6,
  fromName: 'TP. Hồ Chí Minh',
  fromLat: 0,
  fromLon: 0,
  toName: 'Cần Thơ',
  toLat: 0,
  toLon: 0,
  departureDate: '2026-10-20',
  departureTime: '22:30',
  departureAt: '2026-10-20T22:30:00+07:00',
  arrivalAt: '2026-10-21T02:00:00+07:00',
  availableSeats: 3,
  totalSeats: 40,
  status: 'scheduled',
  minPrice: 187000,
  maxPrice: 187000,
  priceAdult: 187000,
  priceChild: 0,
  vehicleType: 'sleeper',
  vehicleTypeLabel: 'Giường nằm',
  amenities: ['wifi', 'ac'],
}

const renderCard = (props: Partial<Parameters<typeof TripCard>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TripCard trip={trip} {...props} />
    </QueryClientProvider>,
  )

describe('TripCard', () => {
  it('shows the real times, journey length and next-day arrival', () => {
    renderCard()
    expect(screen.getByText('22:30')).toBeInTheDocument()
    expect(screen.getByText(/02:00/)).toBeInTheDocument()
    expect(screen.getByText('3h 30p')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('shows the fare as the API gives it, with no made-up original price', () => {
    const { container } = renderCard()
    expect(container.textContent).toContain('187.000')
    expect(container.querySelector('s, del, .line-through')).toBeNull()
  })

  it('says "almost full" only for three seats or fewer', () => {
    renderCard()
    expect(screen.getByText('Sắp hết chỗ')).toBeInTheDocument()
    expect(screen.getByText('Chỉ còn 3 chỗ')).toBeInTheDocument()
  })

  it('marks the cheapest trip only when told', () => {
    renderCard({ trip: { ...trip, availableSeats: 20 } })
    expect(screen.queryByText('Rẻ nhất')).toBeNull()
    expect(screen.queryByText('Sắp hết chỗ')).toBeNull()
  })

  it('opens the trip from the card or its button', () => {
    const onSelect = vi.fn()
    renderCard({ onSelect, cheapest: true })
    expect(screen.getByText('Rẻ nhất')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Chọn chuyến/ }))
    fireEvent.click(screen.getByTestId('trip-card'))
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('names the destination when the schedule has no arrival time', () => {
    renderCard({ trip: { ...trip, arrivalAt: null } })
    expect(screen.getByText('Cần Thơ')).toBeInTheDocument()
    expect(screen.getByText('Xem giờ đến')).toBeInTheDocument()
    expect(screen.queryByText('3h 30p')).toBeNull()
  })
})
