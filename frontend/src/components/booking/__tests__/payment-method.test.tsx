/**
 * Tests for the PaymentMethodStep component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PaymentMethodStep } from '@/components/booking/payment-method'

describe('PaymentMethodStep', () => {
  const baseProps = {
    paymentMethod: 'momo' as const,
    onSetPaymentMethod: vi.fn(),
    seatCount: 2,
    subtotal: 300000,
    insuranceLevel: 'none' as const,
    insuranceCost: 0,
    campaignCode: '',
    discount: 0,
    fees: 0,
    total: 300000,
    currency: 'VND' as const,
    error: '',
    submitting: false,
    onGoBack: vi.fn(),
    onSubmit: vi.fn(),
  }

  it('renders all 4 payment options', () => {
    render(<PaymentMethodStep {...baseProps} />)
    expect(screen.getByText('Ví MoMo')).toBeInTheDocument()
    expect(screen.getByText('VNPay QR')).toBeInTheDocument()
    expect(screen.getByText('Chuyển khoản')).toBeInTheDocument()
    expect(screen.getByText('Thanh toán tại xe')).toBeInTheDocument()
  })

  it('renders the total amount', () => {
    render(<PaymentMethodStep {...baseProps} />)
    // Total appears in both the price summary and the pay button text
    const matches = screen.getAllByText(/300\.000/)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('calls onGoBack when back button is clicked', () => {
    const onGoBack = vi.fn()
    render(<PaymentMethodStep {...baseProps} onGoBack={onGoBack} />)
    fireEvent.click(screen.getByText('Quay lại'))
    expect(onGoBack).toHaveBeenCalled()
  })

  it('calls onSubmit when pay button is clicked', () => {
    const onSubmit = vi.fn()
    const { container } = render(<PaymentMethodStep {...baseProps} onSubmit={onSubmit} />)
    // Find the pay button — it's the last button and contains "Thanh toán" + amount
    // (not "Quay lại" which is the back button).
    const btns = container.querySelectorAll('button')
    const payBtn = Array.from(btns).find(
      (b) =>
        b.textContent?.includes('Thanh toán') &&
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
