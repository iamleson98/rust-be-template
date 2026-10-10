/**
 * Tests for the PaymentMethodStep component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { offeredMethods, PaymentMethodStep } from '@/features/booking/flow/payment-method'
import type { CouponOut } from '@/api'
import type { CheckoutCoupon } from '@/features/booking/flow/use-checkout-coupon'

describe('PaymentMethodStep', () => {
  const held: CouponOut = {
    id: 'k1',
    code: 'DXV7K2M9PQ',
    campaignId: 'c1',
    campaignName: 'Ưu đãi Tết',
    amount: 30000,
    status: 'held',
    allBrands: true,
    brands: [],
    claimedAt: '2026-10-01T03:00:00Z',
    validUntil: '2026-10-31T16:00:00Z',
  }
  const coupon = (over: Partial<CheckoutCoupon> = {}): CheckoutCoupon => ({
    coupon: null,
    usable: false,
    applied: false,
    setApplied: vi.fn(),
    worth: 0,
    discount: 0,
    couponId: undefined,
    ...over,
  })
  const applied = coupon({
    coupon: held,
    usable: true,
    applied: true,
    worth: 30000,
    discount: 30000,
    couponId: 'k1',
  })

  const baseProps = {
    methods: offeredMethods(undefined),
    method: 'momo' as const,
    onMethodChange: vi.fn(),
    coupon: coupon(),
    tickets: [],
    total: 300000,
    error: '',
    submitting: false,
    onBack: vi.fn(),
    onSubmit: vi.fn(),
  }

  it('renders all 4 payment options', () => {
    render(<PaymentMethodStep {...baseProps} />)
    expect(screen.getByText('Ví MoMo')).toBeInTheDocument()
    expect(screen.getByText('VNPay QR')).toBeInTheDocument()
    expect(screen.getByText('Chuyển khoản')).toBeInTheDocument()
    expect(screen.getByText('Thanh toán tại xe')).toBeInTheDocument()
  })

  it('offers only the methods the server takes', () => {
    expect(offeredMethods(['cod', 'vnpay'])).toEqual(['vnpay', 'cod'])
    render(<PaymentMethodStep {...baseProps} methods={['cod']} method="cod" />)
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.getByRole('radio', { name: /Thanh toán tại xe/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.queryByText('Ví MoMo')).not.toBeInTheDocument()
  })

  it('shows no coupon row when the customer holds none', () => {
    render(<PaymentMethodStep {...baseProps} />)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('applies the held coupon by default and takes it off the total', () => {
    render(<PaymentMethodStep {...baseProps} coupon={applied} total={270000} />)
    const row = screen.getByRole('switch', { name: /Dùng mã DXV7K2M9PQ/ })
    expect(row).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Giảm giá (DXV7K2M9PQ)')).toBeInTheDocument()
    // In the coupon row and in the price summary.
    expect(screen.getAllByText(/-30\.000/)).toHaveLength(2)
  })

  it('lets the customer keep the coupon for later', () => {
    render(<PaymentMethodStep {...baseProps} coupon={applied} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(applied.setApplied).toHaveBeenCalledWith(false)
  })

  it('says why the coupon does not apply to this trip', () => {
    const { rerender } = render(
      <PaymentMethodStep {...baseProps} coupon={coupon({ coupon: held, worth: 30000 })} />,
    )
    expect(screen.getByText('Mã của bạn không áp dụng cho nhà xe này.')).toBeInTheDocument()
    rerender(
      <PaymentMethodStep
        {...baseProps}
        coupon={coupon({ coupon: { ...held, status: 'reserved', bookingCode: 'VX-OLD123' } })}
      />,
    )
    expect(screen.getByText('Mã của bạn đang dùng cho vé VX-OLD123.')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('exposes the method picker as a radio group with per-option state', () => {
    render(<PaymentMethodStep {...baseProps} />)
    const group = screen.getByRole('radiogroup')
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
    // momo (default) is checked; the others are not.
    expect(screen.getByRole('radio', { name: /Ví MoMo/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /VNPay QR/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    // The radiogroup lives inside the dialog body.
    expect(group).toBeInTheDocument()
  })

  it('uses brand-colored icon tiles instead of emoji', () => {
    // The old picker rendered 🟣 🔵 🏦 💵 emoji — platform-dependent and
    // visually cheap. The redesign uses lucide icons in colored tiles.
    const { container } = render(<PaymentMethodStep {...baseProps} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/[🟣🔵🏦💵]/u)
    // Each option carries an SVG icon tile.
    const tiles = container.querySelectorAll('span.h-10')
    expect(tiles.length).toBe(4)
    expect(tiles[0].querySelector('svg')).not.toBeNull()
  })

  it('renders the total amount', () => {
    render(<PaymentMethodStep {...baseProps} />)
    // Total appears in both the price summary and the pay button text
    const matches = screen.getAllByText(/300\.000/)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('calls onBack when back button is clicked', () => {
    const onBack = vi.fn()
    render(<PaymentMethodStep {...baseProps} onBack={onBack} />)
    fireEvent.click(screen.getByText('Quay lại'))
    expect(onBack).toHaveBeenCalled()
  })

  it('calls onSubmit when pay button is clicked', () => {
    const onSubmit = vi.fn()
    const { container } = render(<PaymentMethodStep {...baseProps} onSubmit={onSubmit} />)
    // Find the confirm-booking button — it contains "Xác nhận đặt vé" + amount
    // (not "Quay lại" which is the back button).
    const btns = container.querySelectorAll('button')
    const payBtn = Array.from(btns).find(
      (b) =>
        b.textContent?.includes('Xác nhận đặt vé') &&
        !b.textContent?.includes('Quay lại') &&
        b.textContent?.includes('300'),
    )
    expect(payBtn).toBeTruthy()
    if (payBtn) fireEvent.click(payBtn)
    expect(onSubmit).toHaveBeenCalled()
  })

  it('disables pay button when submitting', () => {
    render(<PaymentMethodStep {...baseProps} submitting={true} />)
    const spinner = screen.getByText(/Đang xử lý/)
    const payButton = spinner.closest('button')
    expect(payButton).toBeDisabled()
  })

  it('shows error message when error prop is set', () => {
    render(<PaymentMethodStep {...baseProps} error="Thanh toán thất bại" />)
    expect(screen.getByText('Thanh toán thất bại')).toBeInTheDocument()
  })

  it('says only what is true about security and the ticket', () => {
    render(<PaymentMethodStep {...baseProps} />)
    expect(screen.getByText(/HTTPS/)).toBeInTheDocument()
    expect(screen.queryByText(/SMS|PCI DSS|SSL 256-bit/)).toBeNull()
  })

  it('shows Decree 13 compliance text', () => {
    render(<PaymentMethodStep {...baseProps} />)
    expect(screen.getByText(/Nghị định 13\/2023\/NĐ-CP/i)).toBeInTheDocument()
  })
})
