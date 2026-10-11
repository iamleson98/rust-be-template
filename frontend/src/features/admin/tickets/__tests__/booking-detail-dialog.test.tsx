import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookingItem } from '@/features/booking/history/booking-types'
import { BookingDetailDialog } from '../booking-detail-dialog'

const ticket: BookingItem = {
  id: 'b-1',
  code: 'DXV001',
  status: 'confirmed',
  paymentMethod: 'cod',
  adultCount: 1,
  childCount: 0,
  contactName: 'An',
  contactPhone: '0901234567',
  subtotal: 100000,
  discount: 0,
  fees: 0,
  total: 100000,
  currency: 'VND',
  canCancel: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  seats: [],
  trip: {
    id: 'trip-1',
    departureAt: '2099-01-01T08:00:00Z',
    departureDate: '2099-01-01',
    status: 'scheduled',
    routeId: 'route-1',
    routeName: 'A - B',
    fromName: 'A',
    toName: 'B',
    brandName: 'Brand',
  },
}

const mocks = vi.hoisted(() => ({ updateStatus: vi.fn(async (_vars: unknown) => ({})) }))

vi.mock('@/api', async (importOriginal) => {
  const api = await importOriginal<typeof import('@/api')>()
  return {
    ...api,
    adminBookingsGetOptions: () => ({
      queryKey: ['adminBookingsGet', 'b-1'],
      queryFn: async () => ({ item: ticket }),
    }),
    adminBookingsUpdateStatusMutation: () => ({
      mutationFn: async (vars: unknown) => mocks.updateStatus(vars),
    }),
  }
})

const open = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BookingDetailDialog bookingId="b-1" onClose={() => {}} />
    </QueryClientProvider>,
  )

beforeEach(() => vi.clearAllMocks())

describe('BookingDetailDialog — cancelling', () => {
  it('asks first, then cancels through the API', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Huỷ vé' }))

    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Huỷ vé DXV001?')
    expect(mocks.updateStatus).not.toHaveBeenCalled()

    await user.click(screen.getAllByRole('button', { name: 'Huỷ vé' }).at(-1)!)
    await waitFor(() =>
      expect(mocks.updateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'b-1' }, body: { status: 'cancelled' } }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('does nothing when the admin keeps the ticket', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Huỷ vé' }))
    await user.click(await screen.findByRole('button', { name: 'Không huỷ' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.updateStatus).not.toHaveBeenCalled()
  })
})
