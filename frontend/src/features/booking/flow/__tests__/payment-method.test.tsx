/**
 * Tests for the PaymentMethodStep component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { offeredMethods, PaymentMethodStep } from '@/features/booking/flow/payment-method'
import type { PromoCode } from '@/features/booking/flow/use-promo-code'

describe('PaymentMethodStep', () => {
  const promo = (over: Partial<PromoCode> = {}): PromoCode => ({
    code: '',
    setCode: vi.fn(),
    result: null,
    checking: false,
    apply: vi.fn(),
    discount: 0,
    appliedCode: undefined,
    ...over,
  })

  const baseProps = {
    methods: offeredMethods(undefined),
    method: 'momo' as const,
    onMethodChange: vi.fn(),
    promo: promo(),
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

  it('shows the coupon box on the checkout step', () => {
    // Coupons live on the PAYMENT step now (moved off the contact step).
    render(<PaymentMethodStep {...baseProps} />)
    expect(screen.getByText('Mã khuyến mãi')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/VD: TET2025/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeDisabled()
  })

  it('shows an applied coupon with its discount', () => {
    render(
      <PaymentMethodStep
        {...baseProps}
        promo={promo({
          code: 'summer2024',
          result: { valid: true, discount: 30000 },
          discount: 30000,
          appliedCode: 'SUMMER2024',
        })}
        total={270000}
      />,
    )
    expect(screen.getByText('Đã áp dụng mã SUMMER2024')).toBeInTheDocument()
    // The discount appears in the coupon box AND the price summary.
    expect(screen.getAllByText(/-30\.000/).length).toBeGreaterThan(0)
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

  it('edits and applies the promo code through the promo state', () => {
    const p = promo({ code: 'TET' })
    render(<PaymentMethodStep {...baseProps} promo={p} />)
    fireEvent.change(screen.getByPlaceholderText(/VD: TET2025/), { target: { value: 'TET2026' } })
    expect(p.setCode).toHaveBeenCalledWith('TET2026')
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }))
    expect(p.apply).toHaveBeenCalled()
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

  it('shows SSL trust note', () => {
    render(<PaymentMethodStep {...baseProps} />)
    expect(screen.getByText(/SSL 256-bit/i)).toBeInTheDocument()
  })

  it('shows Decree 13 compliance text', () => {
    render(<PaymentMethodStep {...baseProps} />)
    expect(screen.getByText(/Nghị định 13\/2023\/NĐ-CP/i)).toBeInTheDocument()
  })

  it('shows payment trust badges (SSL, PCI DSS, refund)', () => {
    render(<PaymentMethodStep {...baseProps} />)
    expect(screen.getByText('Mã hoá SSL')).toBeInTheDocument()
    expect(screen.getByText('PCI DSS')).toBeInTheDocument()
    expect(screen.getByText('Hoàn tiền 24h')).toBeInTheDocument()
  })
})
