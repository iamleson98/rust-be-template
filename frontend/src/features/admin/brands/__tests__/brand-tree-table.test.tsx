import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

/**
 * Integration test for the /admin/brands redesign: the 3-level subtree
 * table (brands → routes → schedules), the smart start/end filter and
 * the schedule sorting — all against mocked query hooks.
 */

vi.mock('@/lib/queries', () => {
  const pendingMutation = () => ({ isPending: false, mutateAsync: vi.fn() })
  return {
    useAdminBrands: vi.fn(),
    useAdminRoutes: vi.fn(),
    useAdminSchedules: vi.fn(),
    useAdminBusLayouts: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
    useAdminPickupPoints: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
    usePlacesList: vi.fn(() => ({ data: { items: [] } })),
    usePlaceSearch: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
    useAdminBrandsListQueryKey: vi.fn(() => ['brands']),
    useDeleteAdminBrand: vi.fn(pendingMutation),
    useDeleteAdminRoute: vi.fn(pendingMutation),
    useDeleteAdminSchedule: vi.fn(pendingMutation),
    useUpsertAdminBrand: vi.fn(pendingMutation),
    useUpsertAdminRoute: vi.fn(pendingMutation),
    useUpdateAdminRoute: vi.fn(pendingMutation),
    useUpsertAdminSchedule: vi.fn(pendingMutation),
    useUpdateAdminSchedule: vi.fn(pendingMutation),
    useUpsertAdminPickupPoint: vi.fn(pendingMutation),
    useDeleteAdminPickupPoint: vi.fn(pendingMutation),
    useCreateAdminAddress: vi.fn(pendingMutation),
    useUpsertAdminBusLayout: vi.fn(pendingMutation),
    useUpdateAdminBusLayout: vi.fn(pendingMutation),
  }
})

import { useAdminBrands, useAdminRoutes, useAdminSchedules } from '@/lib/queries'
import { AdminBrandManagement } from '../index'

const brandsMock = useAdminBrands as unknown as ReturnType<typeof vi.fn>
const routesMock = useAdminRoutes as unknown as ReturnType<typeof vi.fn>
const schedulesMock = useAdminSchedules as unknown as ReturnType<typeof vi.fn>

const BRANDS = [
  {
    id: 'b-1',
    name: 'Phương Trang',
    slug: 'phuong-trang',
    contactPhone: '19006067',
    contactEmail: null,
    rating: 4.5,
    status: 'active',
    accentColor: '#0ea5e9',
    totalTrips: 12,
    routeCount: 2,
    layoutCount: 1,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'b-2',
    name: 'Thành Bùi',
    slug: 'thanh-bui',
    contactPhone: null,
    contactEmail: null,
    rating: null,
    status: 'active',
    accentColor: '#f59e0b',
    totalTrips: 4,
    routeCount: 1,
    layoutCount: 0,
    createdAt: '',
    updatedAt: '',
  },
]

const ROUTES = [
  {
    id: 'r-1',
    brandId: 'b-1',
    name: 'Sài Gòn → Nha Trang',
    startLocationId: 'ho-chi-minh',
    endLocationId: 'khanh-hoa',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    startLocation: { id: 'ho-chi-minh', name: 'Hồ Chí Minh', province: 'Hồ Chí Minh' },
    endLocation: { id: 'khanh-hoa', name: 'Nha Trang', province: 'Khánh Hoà' },
    scheduleCount: 2,
    pickupPointCount: 3,
  },
  {
    id: 'r-2',
    brandId: 'b-1',
    name: 'Sài Gòn → Đà Lạt',
    startLocationId: 'ho-chi-minh',
    endLocationId: 'lam-dong',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    startLocation: { id: 'ho-chi-minh', name: 'Hồ Chí Minh', province: 'Hồ Chí Minh' },
    endLocation: { id: 'lam-dong', name: 'Đà Lạt', province: 'Lâm Đồng' },
    scheduleCount: 0,
    pickupPointCount: 0,
  },
  {
    id: 'r-3',
    brandId: 'b-2',
    name: 'Hà Nội → Hải Phòng',
    startLocationId: 'ha-noi',
    endLocationId: 'hai-phong',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    startLocation: { id: 'ha-noi', name: 'Hà Nội', province: 'Hà Nội' },
    endLocation: { id: 'hai-phong', name: 'Hải Phòng', province: 'Hải Phòng' },
    scheduleCount: 0,
    pickupPointCount: 0,
  },
]

const SCHEDULES = [
  {
    id: 's-1',
    routeId: 'r-1',
    departureTime: '20:00',
    effectiveFrom: '2026-10-01',
    effectiveTo: '2026-12-01',
    daysOfWeek: '1111111',
    busLayoutId: null,
    vehicleTypeId: null,
    vehicleType: null,
    basePriceAdult: 320000,
    basePriceChild: null,
    amenities: null,
    points: [],
    createdAt: '',
  },
  {
    id: 's-2',
    routeId: 'r-1',
    departureTime: '08:30',
    effectiveFrom: '2026-11-01',
    effectiveTo: null,
    daysOfWeek: '1111100',
    busLayoutId: null,
    vehicleTypeId: null,
    vehicleType: null,
    basePriceAdult: 250000,
    basePriceChild: 120000,
    amenities: null,
    points: [],
    createdAt: '',
  },
]

/** Open one of the toolbar filter selects and pick an option. Base UI's
 *  Select.Trigger needs the full pointer sequence (pointerdown →
 *  mouseup → click) that userEvent provides — a bare fireEvent.click
 *  never opens the popup. The item text may sit directly on the item
 *  element, so no [data-slot] descendant selector. */
async function pickOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(screen.getByRole('combobox', { name: label }))
  // Base UI leaves the previous popup mounted (hidden) after it closes,
  // so a city name can match twice — the freshly opened popup is the
  // LAST one in DOM order. Click that copy.
  const items = await screen.findAllByText(option)
  await user.click(items[items.length - 1])
}

const okQuery = (data: unknown) => ({ data, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() })

function setupDefaultMocks() {
  brandsMock.mockReturnValue(okQuery({ items: BRANDS }))
  // Routes: filter by the brandId arg (mirrors the real query). The
  // result objects are memoized per argument shape so `data` keeps a
  // stable reference across renders — exactly what react-query does —
  // otherwise every render looks like a data swap.
  const routeResults = new Map<string, unknown>()
  routesMock.mockImplementation((query?: { brandId?: string; startLocationId?: string; endLocationId?: string }) => {
    if (!query) return { data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }
    const key = `${query.brandId ?? ''}|${query.startLocationId ?? ''}|${query.endLocationId ?? ''}`
    if (!routeResults.has(key)) {
      let items = ROUTES
      if (query.brandId) items = items.filter((r) => r.brandId === query.brandId)
      if (query.startLocationId) items = items.filter((r) => r.startLocationId === query.startLocationId)
      if (query.endLocationId) items = items.filter((r) => r.endLocationId === query.endLocationId)
      routeResults.set(key, okQuery({ items, total: items.length }))
    }
    return routeResults.get(key)
  })
  const scheduleResults = new Map<string, unknown>()
  schedulesMock.mockImplementation((routeId?: string) => {
    if (!routeId) return { data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }
    if (!scheduleResults.has(routeId)) {
      scheduleResults.set(routeId, okQuery({ items: SCHEDULES.filter((s) => s.routeId === routeId) }))
    }
    return scheduleResults.get(routeId)
  })
}

describe('AdminBrandManagement (tree table redesign)', () => {
  it('renders the brand level with counts and hides routes until expanded', async () => {
    setupDefaultMocks()
    render(<AdminBrandManagement />)

    const brandRow = screen.getByTestId('brand-row-phuong-trang')
    expect(within(brandRow).getByText('Phương Trang')).toBeInTheDocument()
    expect(within(brandRow).getByText('2 tuyến')).toBeInTheDocument()
    // Route rows only render after expansion.
    expect(screen.queryByText('Sài Gòn → Nha Trang')).not.toBeInTheDocument()
  })

  it('expands brand → route → schedule levels step by step', async () => {
    const user = userEvent.setup()
    setupDefaultMocks()
    render(<AdminBrandManagement />)

    // Level 2: expand the brand.
    await user.click(screen.getByTestId('brand-row-phuong-trang').querySelector('button[aria-expanded]')!)
    const routeRow = await screen.findByText('Sài Gòn → Nha Trang')
    expect(routeRow).toBeInTheDocument()
    expect(screen.getByText('Sài Gòn → Đà Lạt')).toBeInTheDocument()
    // The other brand's routes are NOT loaded (its own query is off).
    expect(screen.queryByText('Hà Nội → Hải Phòng')).not.toBeInTheDocument()

    // Level 3: expand the route → schedule rows.
    await user.click(screen.getByText('Sài Gòn → Nha Trang').closest('tr')!.querySelector('button[aria-expanded]')!)
    await screen.findByText('20:00')
    expect(screen.getByText('08:30')).toBeInTheDocument()
    // Schedule row content: day chips (daily = all 7 active, label in
    // the tooltip) + formatted price.
    expect(screen.getByTitle('Hàng ngày')).toBeInTheDocument()
    expect(screen.getByText(/320\.000/)).toBeInTheDocument()
  })

  it('applies schedule sorting within the route group only', async () => {
    const user = userEvent.setup()
    setupDefaultMocks()
    render(<AdminBrandManagement />)

    // Expand down to schedules.
    await user.click(screen.getByTestId('brand-row-phuong-trang').querySelector('button[aria-expanded]')!)
    await screen.findByText('Sài Gòn → Nha Trang')
    await user.click(screen.getByText('Sài Gòn → Nha Trang').closest('tr')!.querySelector('button[aria-expanded]')!)
    await screen.findByText('20:00')

    // Server order: 20:00 then 08:30. Sort by departure time asc.
    const sortTrigger = screen.getByRole('combobox', { name: 'Sắp xếp lịch trình' })
    await user.click(sortTrigger)
    await user.click(screen.getByText('Giờ khởi hành'))

    // Rows reorder: 08:30 first. The table rows order reflects the sort
    // within the group (brand + route rows stay above).
    const times = screen.getAllByText(/^(08:30|20:00)$/).map((el) => el.textContent)
    expect(times[0]).toBe('08:30')
    expect(times).toContain('20:00')
  })

  it('smart start/end filter shows only matching brands with routes inline', async () => {
    // Base UI popup items keep `pointer-events: none` while their enter
    // transition runs — jsdom never fires transitionend, so the check
    // must be off to click them.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    setupDefaultMocks()
    render(<AdminBrandManagement />)

    // Pick start (Hồ Chí Minh) + end (Nha Trang → Khánh Hoà province list).
    await pickOption(user, 'Điểm đi', 'TP. Hồ Chí Minh')
    await pickOption(user, 'Điểm đến', 'Khánh Hòa')

    // Auto-expanded matching routes render without manual expansion.
    await screen.findByText('Sài Gòn → Nha Trang')

    // Brands without a matching route are hidden entirely.
    expect(screen.queryByTestId('brand-row-thanh-bui')).not.toBeInTheDocument()
    // Non-matching routes of the matching brand are hidden too.
    expect(screen.queryByText('Sài Gòn → Đà Lạt')).not.toBeInTheDocument()

    // Clearing the filter collapses the tree again.
    await user.click(screen.getByRole('button', { name: /xoá lọc/i }))
    await expect(screen.queryByText('Sài Gòn → Nha Trang')).not.toBeInTheDocument()
    expect(screen.getByTestId('brand-row-thanh-bui')).toBeInTheDocument()
  })

  it('shows a filter-aware empty state when nothing matches', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    setupDefaultMocks()
    render(<AdminBrandManagement />)

    await pickOption(user, 'Điểm đi', 'Hà Nội')

    // Only brand 2 runs from Hà Nội — pick an end no route reaches.
    await pickOption(user, 'Điểm đến', 'Cần Thơ')

    await screen.findByText('Không có hãng xe khớp bộ lọc')
    expect(screen.getByText(/thử đổi từ khoá hoặc xoá bộ lọc/i)).toBeInTheDocument()
  })
})
