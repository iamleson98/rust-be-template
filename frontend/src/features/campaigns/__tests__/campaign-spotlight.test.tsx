/**
 * The home page's campaign band against a fake API: what each visitor sees
 * (guest, customer, staff), the coupon they hold, and claiming a tier.
 */
import type { ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CouponOut, PublicCampaignListResponse, SessionUser } from '@/api'
import { mockApi, renderWithQuery } from '@/test/api'
import { useSession } from '@/stores/session'
import { CampaignSpotlight } from '../campaign-spotlight'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, ...props }: { children: ReactNode }) => (
    <a {...(props as object)}>{children}</a>
  ),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const NOW = '2026-10-10T03:00:00Z'

const list = (over: Partial<PublicCampaignListResponse['items'][number]> = {}) => ({
  serverTime: NOW,
  items: [
    {
      id: 'c1',
      name: 'Ưu đãi Tết',
      description: 'Giảm thẳng vào giá vé',
      startsAt: '2026-10-01T00:00:00Z',
      endsAt: '2026-10-31T16:59:59Z',
      couponValidity: 'campaign',
      allBrands: true,
      brands: [],
      tiers: [
        { id: 't1', amount: 50000, totalSlots: 10, remaining: 3 },
        { id: 't2', amount: 20000, totalSlots: 100, remaining: 0 },
      ],
      ...over,
    },
  ],
})

const held: CouponOut = {
  id: 'k1',
  code: 'DXV7K2M9PQ',
  campaignId: 'c1',
  campaignName: 'Ưu đãi Tết',
  amount: 50000,
  status: 'held',
  allBrands: true,
  brands: [],
  claimedAt: NOW,
  validUntil: '2026-10-31T16:59:59Z',
}

const signIn = (role: string) =>
  useSession.setState({ user: { id: 'u1', name: 'An', role, type: role } as SessionUser })

afterEach(() => {
  useSession.setState({ user: null })
  vi.clearAllMocks()
})

describe('CampaignSpotlight', () => {
  it('shows nothing when no campaign is on', async () => {
    const api = mockApi({ 'GET /api/campaigns': { serverTime: NOW, items: [] } })
    const { container } = renderWithQuery(<CampaignSpotlight />)
    await waitFor(() => expect(api.calls).toHaveLength(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('invites a guest to sign in, with slots left and the countdown', async () => {
    mockApi({ 'GET /api/campaigns': list() })
    renderWithQuery(<CampaignSpotlight />)

    expect(await screen.findByText('Ưu đãi Tết')).toBeInTheDocument()
    expect(screen.getByText('Còn 3/10')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent(/^Kết thúc sau 21 ngày \d\d:\d\d:\d\d$/)
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập để nhận' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/login', search: { redirect: '/#campaigns' } })
    expect(screen.getByRole('button', { name: 'Hết lượt' })).toBeDisabled()
  })

  it('lets a customer claim a tier', async () => {
    signIn('user')
    const api = mockApi({
      'GET /api/campaigns': list(),
      'GET /api/coupons/mine': { active: null, claimedCampaignIds: [] },
      'POST /api/campaigns/c1/tiers/t1/claim': () => Response.json(held, { status: 201 }),
    })
    renderWithQuery(<CampaignSpotlight />)

    fireEvent.click(await screen.findByRole('button', { name: 'Nhận mã' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(api.last('/api/campaigns/c1/tiers/t1/claim')?.method).toBe('POST')
  })

  it('explains a claim that lost the race', async () => {
    signIn('user')
    mockApi({
      'GET /api/campaigns': list(),
      'GET /api/coupons/mine': { active: null, claimedCampaignIds: [] },
      'POST /api/campaigns/c1/tiers/t1/claim': () =>
        Response.json({ error: 'gone', message: 'resource gone: tier_sold_out' }, { status: 410 }),
    })
    renderWithQuery(<CampaignSpotlight />)

    fireEvent.click(await screen.findByRole('button', { name: 'Nhận mã' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Mức giảm này vừa hết lượt.'))
  })

  it('shows the coupon a customer holds and closes the campaign they claimed from', async () => {
    signIn('user')
    const tiers = [
      { id: 't1', amount: 50000, totalSlots: 10, remaining: 3 },
      { id: 't2', amount: 20000, totalSlots: 100, remaining: 40 },
    ]
    mockApi({
      'GET /api/campaigns': list({ tiers }),
      'GET /api/coupons/mine': { active: held, claimedCampaignIds: ['c1'] },
    })
    renderWithQuery(<CampaignSpotlight />)

    expect(await screen.findByText('DXV7K2M9PQ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bỏ mã' })).toBeEnabled()
    // Its own tier says so; the others say why they are closed.
    expect(screen.getByRole('button', { name: 'Mã của bạn' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '1 mã mỗi chương trình' })).toBeDisabled()
  })

  it('closes other campaigns while the customer holds a coupon', async () => {
    signIn('user')
    mockApi({
      'GET /api/campaigns': list(),
      'GET /api/coupons/mine': {
        active: { ...held, campaignId: 'other', campaignName: 'Khác' },
        claimedCampaignIds: ['other'],
      },
    })
    renderWithQuery(<CampaignSpotlight />)

    expect(await screen.findByRole('button', { name: 'Bạn đang giữ mã khác' })).toBeDisabled()
  })

  it('tells staff that coupons are for customers', async () => {
    signIn('employee')
    const api = mockApi({ 'GET /api/campaigns': list() })
    renderWithQuery(<CampaignSpotlight />)

    expect(
      await screen.findByText('Mã giảm giá dành cho tài khoản khách hàng.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nhận mã' })).toBeDisabled()
    expect(api.calls.some((c) => c.url.pathname === '/api/coupons/mine')).toBe(false)
  })

  it('counts down to an upcoming campaign', async () => {
    signIn('user')
    mockApi({
      'GET /api/campaigns': list({ startsAt: '2026-10-10T05:00:00Z' }),
      'GET /api/coupons/mine': { active: null, claimedCampaignIds: [] },
    })
    renderWithQuery(<CampaignSpotlight />)

    expect(await screen.findByRole('timer')).toHaveTextContent(/^Mở sau 0\d:\d\d:\d\d$/)
    for (const b of screen.getAllByRole('button', { name: 'Sắp mở' })) expect(b).toBeDisabled()
  })
})
