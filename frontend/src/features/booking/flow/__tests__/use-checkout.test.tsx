/**
 * The checkout against a fake API: cash bookings are confirmed at once, online
 * payments wait for the gateway, and each failure shows the right message.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '@/test/api'
import { useBookingFlow } from '@/stores/booking-flow'
import type { BookingValues } from '../booking-form'
import type { PaymentMethodKey } from '../payment-method'
import { useCheckout } from '../use-checkout'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/analytics', () => ({ trackConversion: vi.fn() }))

const BOOKING = 'b0000000-0000-4000-8000-000000000001'
const PAYMENT = 'p0000000-0000-4000-8000-000000000001'

const context = {
  tripId: 't1',
  seatIds: ['s1'],
  boardingPointId: 'pp1',
  droppingPointId: 'pp2',
}

const values: BookingValues = {
  passengers: [{ name: 'Nguyễn Văn A', age: 30, gender: 'male', seatId: 's1' }],
  contactName: 'Nguyễn Văn A',
  contactPhone: '0912345678',
  contactEmail: '',
}

const hold = {
  bookingId: BOOKING,
  code: 'VX-ABC123',
  status: 'pending',
  subtotal: 350000,
  discount: 0,
  fees: 0,
  total: 350000,
  expiresAt: '2026-10-09T10:00:00Z',
  seats: [],
}

const payment = (status: string) => ({
  id: PAYMENT,
  bookingId: BOOKING,
  provider: 'vnpay',
  status,
  amount: 350000,
  currency: 'VND',
  createdAt: '2026-10-09T09:50:00Z',
  providerTxnRef: 'ref',
  gatewayUrl: 'https://pay.example/vnpay',
})

function setup(method: PaymentMethodKey, couponId?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => {
      const form = useForm<BookingValues>({ defaultValues: values })
      return useCheckout({ form, context, method, couponId })
    },
    { wrapper },
  )
}

beforeEach(() => {
  useBookingFlow.setState({ step: 'payment', context, lastBooking: null })
})

describe('useCheckout', () => {
  it('places a cash booking for the operator to confirm by phone', async () => {
    const api = mockApi({
      'POST /api/bookings': hold,
      [`POST /api/bookings/${BOOKING}/place`]: {
        bookingId: BOOKING,
        status: 'pending',
        paymentMethod: 'cod',
      },
    })
    const { result } = setup('cod')

    await act(() => result.current.submit(values))

    expect(useBookingFlow.getState().step).toBe('success')
    expect(useBookingFlow.getState().lastBooking).toEqual({
      id: BOOKING,
      code: 'VX-ABC123',
      total: 350000,
      awaitingCall: true,
    })
    expect(api.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'POST /api/bookings',
      `POST /api/bookings/${BOOKING}/place`,
    ])
    expect(result.current.error).toBe('')
  })

  it('pays online: waits on the gateway, then succeeds when the payment completes', async () => {
    let status = 'pending'
    mockApi({
      'POST /api/bookings': hold,
      'POST /api/payments': { payment: payment('pending') },
      [`GET /api/payments/${PAYMENT}`]: () => payment(status),
    })
    const { result } = setup('vnpay')

    await act(() => result.current.submit(values))
    expect(useBookingFlow.getState().step).toBe('pay')
    await waitFor(() => expect(result.current.payment?.status).toBe('pending'))

    status = 'completed'
    await waitFor(() => expect(useBookingFlow.getState().step).toBe('success'), {
      timeout: 6000,
    })
  })

  it('reports a failed hold and stays on the payment step', async () => {
    mockApi({
      'POST /api/bookings': () =>
        Response.json({ error: 'conflict', message: 'seats taken' }, { status: 409 }),
    })
    const { result } = setup('cod')

    await act(() => result.current.submit(values))

    expect(result.current.error).not.toBe('')
    expect(result.current.submitting).toBe(false)
    expect(useBookingFlow.getState().step).toBe('payment')
  })

  it('reports a gateway that cannot start the payment', async () => {
    mockApi({
      'POST /api/bookings': hold,
      'POST /api/payments': () =>
        Response.json({ error: 'bad_request', message: 'provider off' }, { status: 400 }),
    })
    const { result } = setup('momo')

    await act(() => result.current.submit(values))

    expect(result.current.error).not.toBe('')
    expect(useBookingFlow.getState().step).toBe('payment')
    expect(result.current.hold?.code).toBe('VX-ABC123')
  })

  it('sends the applied coupon with the seat hold', async () => {
    const COUPON = 'c0000000-0000-4000-8000-000000000001'
    let sent: Promise<{ couponId?: string }> | undefined
    mockApi({
      'POST /api/bookings': (_url: URL, request: Request) => {
        sent = request.clone().json()
        return { ...hold, discount: 50000, total: 300000, couponId: COUPON }
      },
      [`POST /api/bookings/${BOOKING}/place`]: {
        bookingId: BOOKING,
        status: 'pending',
        paymentMethod: 'cod',
      },
    })
    const { result } = setup('cod', COUPON)

    await act(() => result.current.submit(values))

    expect((await sent)?.couponId).toBe(COUPON)
    expect(useBookingFlow.getState().lastBooking?.total).toBe(300000)
  })

  it('explains a coupon the server no longer accepts', async () => {
    mockApi({
      'POST /api/bookings': () =>
        Response.json(
          { error: 'bad_request', message: 'bad request: coupon_expired' },
          { status: 400 },
        ),
    })
    const { result } = setup('cod', 'c0000000-0000-4000-8000-000000000001')

    await act(() => result.current.submit(values))

    expect(result.current.error).toBe('Mã đã hết hạn.')
    expect(useBookingFlow.getState().step).toBe('payment')
  })
})
