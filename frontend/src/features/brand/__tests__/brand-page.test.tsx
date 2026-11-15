import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { vnDate } from '@/lib/search-params'
import { mockApi, renderWithQuery } from '@/test/api'
import type { BrandProfile } from '../api'
import { BrandPage } from '../brand-page'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ slug: 'phuong-trang' }),
  useNavigate: () => navigate,
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
  }) => (
    <a href={to.replace(/\$(\w+)/g, (_, k: string) => params?.[k] ?? '')} {...props}>
      {children}
    </a>
  ),
}))

// The reviews fetch their own data and only mount near the viewport.
vi.mock('@/features/reviews/reviews-list', () => ({
  ReviewsList: ({ brandName }: { brandName: string }) => <div>reviews of {brandName}</div>,
}))

const profile = (over: Partial<BrandProfile> = {}): BrandProfile => ({
  brand: {
    id: 'b-1',
    slug: 'phuong-trang',
    name: 'Phương Trang',
    logoUrl: null,
    description: 'Hãng xe lớn nhất miền Nam.',
    contactPhone: '1900 6067',
    contactEmail: 'cskh@phuongtrang.vn',
    rating: 4.6,
    reviewCount: 120,
  },
  locations: [
    {
      id: 'l-1',
      name: 'Văn phòng Quận 5',
      address: '272 Đề Thám',
      city: 'Hồ Chí Minh',
      lat: 10.76,
      lon: 106.69,
    },
    { id: 'l-2', name: 'Bến xe Đà Lạt', address: null, city: 'Lâm Đồng', lat: null, lon: null },
  ],
  routes: [
    {
      id: 'r-1',
      name: 'Sài Gòn - Đà Lạt',
      from: { name: 'Sài Gòn', lat: 10.8, lon: 106.7 },
      to: { name: 'Đà Lạt', lat: 11.9, lon: 108.4 },
      priceFrom: 250000,
      schedules: [
        {
          id: 's-1',
          departureTime: '07:00',
          daysOfWeek: null,
          vehicleType: 'Giường nằm',
          priceAdult: 250000,
        },
        {
          id: 's-2',
          departureTime: '22:00',
          daysOfWeek: '1010100',
          vehicleType: 'Limousine',
          priceAdult: 320000,
        },
      ],
    },
    {
      id: 'r-2',
      name: 'Sài Gòn - Nha Trang',
      from: { name: 'Sài Gòn', lat: 10.8, lon: 106.7 },
      to: { name: 'Nha Trang', lat: 12.2, lon: 109.2 },
      priceFrom: null,
      schedules: [],
    },
  ],
  trips: [
    {
      tripId: 't-1',
      routeId: 'r-1',
      date: vnDate(0),
      departureTime: '22:00',
      availableSeats: 3,
      totalSeats: 34,
      vehicleType: 'Limousine',
      priceAdult: 320000,
    },
    {
      tripId: 't-2',
      routeId: 'r-1',
      date: vnDate(0),
      departureTime: '23:00',
      availableSeats: 0,
      totalSeats: 34,
      vehicleType: null,
      priceAdult: 250000,
    },
  ],
  ...over,
})

const serve = (body: BrandProfile | Response) =>
  mockApi({ 'GET /api/brands/phuong-trang/profile': body })

beforeEach(() => navigate.mockReset())

describe('BrandPage', () => {
  it('shows who the brand is, how to reach them and how good they are', async () => {
    serve(profile())
    renderWithQuery(<BrandPage />)

    expect(await screen.findByRole('heading', { name: 'Phương Trang', level: 1 })).toBeVisible()
    expect(screen.getByText('Hãng xe lớn nhất miền Nam.')).toBeVisible()
    expect(screen.getByRole('link', { name: /1900 6067/ })).toHaveAttribute('href', 'tel:19006067')
    expect(screen.getByRole('link', { name: /cskh@phuongtrang\.vn/ })).toHaveAttribute(
      'href',
      'mailto:cskh@phuongtrang.vn',
    )
    expect(screen.getByText('4.6')).toBeVisible()
  })

  it('shows no rating, never 0.0, for a brand nobody reviewed', async () => {
    const base = profile()
    serve({ ...base, brand: { ...base.brand, rating: null, reviewCount: 0 } })
    renderWithQuery(<BrandPage />)

    expect(await screen.findByText('Chưa có đánh giá')).toBeVisible()
    expect(screen.queryByText('0.0')).not.toBeInTheDocument()
  })

  it('counts each section in the jump nav', async () => {
    serve(profile())
    renderWithQuery(<BrandPage />)

    const nav = await screen.findByRole('navigation', { name: 'Mục trên trang' })
    const link = (name: string) => within(nav).getByRole('link', { name: new RegExp(name) })
    expect(link('Tuyến đường')).toHaveTextContent('2')
    expect(link('Chuyến sắp chạy')).toHaveTextContent('2')
    expect(link('Địa điểm')).toHaveTextContent('2')
    expect(link('Đánh giá')).toHaveTextContent('120')
    expect(link('Tuyến đường')).toHaveAttribute('href', '#tuyen-duong')
  })

  it('lists the routes with their fare range and departure times', async () => {
    serve(profile())
    renderWithQuery(<BrandPage />)

    const routes = await screen.findByRole('heading', { name: /Tuyến đường & lịch chạy/ })
    const section = routes.closest('section') as HTMLElement
    const card = within(section)
      .getByRole('heading', { name: /Sài Gòn\s*Đà Lạt/ })
      .closest('[data-slot="card"]')
    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText('Xuất bến 07:00 – 22:00')).toBeVisible()
    expect(within(card as HTMLElement).getByText('Giá từ')).toBeVisible()
    // A route without schedules has no price to show.
    expect(within(section).getByText('Chưa có giá')).toBeVisible()
  })

  it('flags almost-full and sold-out trips among the upcoming ones', async () => {
    serve(profile())
    renderWithQuery(<BrandPage />)

    expect(await screen.findByText(/Sắp hết · còn 3 chỗ/)).toBeVisible()
    expect(screen.getByText('Hết chỗ')).toBeVisible()
    expect(screen.getByRole('tab', { name: /Hôm nay/ })).toBeVisible()
    const trip = screen.getByRole('link', { name: /22:00/ })
    expect(trip).toHaveAttribute('href', '/trips/t-1')
  })

  it('says so when no trip leaves in the coming days', async () => {
    serve(profile({ trips: [] }))
    renderWithQuery(<BrandPage />)

    expect(await screen.findByText(/Chưa có chuyến nào trong 3 ngày tới/)).toBeVisible()
  })

  it('says so when the brand runs no route, and offers no quick-book box', async () => {
    serve(profile({ routes: [], trips: [] }))
    renderWithQuery(<BrandPage />)

    expect(await screen.findByText('Chưa có tuyến đường')).toBeVisible()
    expect(screen.queryByText(/Đặt vé Phương Trang/)).not.toBeInTheDocument()
  })

  it('opens the search for a route, filtered to this brand', async () => {
    serve(profile())
    renderWithQuery(<BrandPage />)

    const routes = (
      await screen.findByRole('heading', { name: /Tuyến đường & lịch chạy/ })
    ).closest('section') as HTMLElement
    const card = within(routes)
      .getByRole('heading', { name: /Sài Gòn\s*Đà Lạt/ })
      .closest('[data-slot="card"]') as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: /Tìm chuyến/ }))

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({
      to: '/search',
      search: expect.objectContaining({
        from: 'Sài Gòn',
        to: 'Đà Lạt',
        date: vnDate(1),
        brands: 'phuong-trang',
      }),
    })
  })

  it('folds the locations past the sixth behind "show more"', async () => {
    const locations = Array.from({ length: 8 }, (_, i) => ({
      id: `l-${i}`,
      name: `Điểm ${i}`,
      address: null,
      city: 'Hà Nội',
      lat: null,
      lon: null,
    }))
    serve(profile({ locations }))
    renderWithQuery(<BrandPage />)

    expect(await screen.findByText('Điểm 5')).toBeVisible()
    expect(screen.queryByText('Điểm 6')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Xem thêm 2' }))
    expect(screen.getByText('Điểm 7')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Thu gọn' }))
    expect(screen.queryByText('Điểm 6')).not.toBeInTheDocument()
  })

  it('links a location to the map only when it has coordinates', async () => {
    serve(profile())
    renderWithQuery(<BrandPage />)

    const maps = await screen.findAllByRole('link', { name: /Xem bản đồ/ })
    expect(maps).toHaveLength(1)
    expect(maps[0]).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=10.76,106.69',
    )
  })

  it('shows an error with a retry when the profile cannot be loaded', async () => {
    const { calls } = serve(Response.json({ error: 'boom' }, { status: 500 }))
    renderWithQuery(<BrandPage />)

    expect(await screen.findByText('Không thể tải thông tin hãng xe')).toBeVisible()
    const before = calls.length
    await userEvent.click(screen.getByRole('button', { name: /Thử lại/ }))
    await waitFor(() => expect(calls.length).toBeGreaterThan(before))
  })
})
