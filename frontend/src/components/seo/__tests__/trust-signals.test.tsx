/**
 * Tests for trust-signal components — TrustBar and PrivacyNotice.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrustBar, PrivacyNotice } from '@/components/seo/trust-signals'

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
