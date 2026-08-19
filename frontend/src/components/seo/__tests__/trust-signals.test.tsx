/**
 * Tests for trust-signal components — TrustBar, PrivacyNotice,
 * PaymentTrustBadges, InfoBanner.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  TrustBar,
  PrivacyNotice,
  PaymentTrustBadges,
  InfoBanner,
} from '@/components/seo/trust-signals'
import { ShieldCheck, Info } from 'lucide-react'

describe('TrustBar', () => {
  it('renders all 3 trust badges', () => {
    render(<TrustBar />)
    expect(screen.getByText('SSL 256-bit')).toBeInTheDocument()
    expect(screen.getByText('Bảo vệ dữ liệu')).toBeInTheDocument()
    expect(screen.getByText('NĐ-CP 13/2023')).toBeInTheDocument()
  })

  it('has an accessible region label', () => {
    render(<TrustBar />)
    expect(screen.getByRole('region', { name: /bảo mật/i })).toBeInTheDocument()
  })
})

describe('PrivacyNotice', () => {
  it('shows data protection copy', () => {
    render(<PrivacyNotice />)
    expect(screen.getByText(/Thông tin của bạn được bảo vệ/i)).toBeInTheDocument()
  })

  it('mentions Decree 13/2023/NĐ-CP', () => {
    render(<PrivacyNotice />)
    expect(screen.getByText(/Nghị định 13\/2023\/NĐ-CP/i)).toBeInTheDocument()
  })

  it('affirms data is not shared with third parties', () => {
    render(<PrivacyNotice />)
    expect(screen.getByText(/Không chia sẻ với bên thứ ba/i)).toBeInTheDocument()
  })

  it('mentions consumer rights (access, edit, delete)', () => {
    render(<PrivacyNotice />)
    expect(screen.getByText(/truy cập.*chỉnh sửa.*xoá/i)).toBeInTheDocument()
  })

  it('has an accessible note role', () => {
    render(<PrivacyNotice />)
    expect(screen.getByRole('note', { name: /bảo mật/i })).toBeInTheDocument()
  })
})

describe('PaymentTrustBadges', () => {
  it('renders SSL, PCI DSS, and refund badges', () => {
    render(<PaymentTrustBadges />)
    expect(screen.getByText('Mã hoá SSL')).toBeInTheDocument()
    expect(screen.getByText('PCI DSS')).toBeInTheDocument()
    expect(screen.getByText('Hoàn tiền 24h')).toBeInTheDocument()
  })
})

describe('InfoBanner', () => {
  it('renders title and children', () => {
    render(
      <InfoBanner icon={Info} title="Test Title">
        Test content
      </InfoBanner>,
    )
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test content')).toBeInTheDocument()
  })

  it('renders without title', () => {
    render(
      <InfoBanner icon={Info}>
        No title content
      </InfoBanner>,
    )
    expect(screen.getByText('No title content')).toBeInTheDocument()
  })

  it('applies variant classes', () => {
    const { container: warningContainer } = render(
      <InfoBanner icon={Info} variant="warning" title="Warning">
        content
      </InfoBanner>,
    )
    expect(warningContainer.querySelector('[class*="border-warning"]')).toBeTruthy()
  })
})
