import { describe, expect, it } from 'vitest'
import type { CouponOut } from '@/api'
import { translate } from '@/lib/i18n'
import { couponErrorCode, couponErrorText, coversBrand } from '../api'

const t = (key: string, params?: Record<string, string | number>) => translate('vi', key, params)

const coupon: CouponOut = {
  id: 'k1',
  code: 'DXV7K2M9PQ',
  campaignId: 'c1',
  campaignName: 'Tết',
  amount: 50000,
  status: 'held',
  allBrands: false,
  brands: [{ id: 'b1', name: 'Phương Trang', slug: 'phuong-trang' }],
  claimedAt: '2026-10-01T03:00:00Z',
}

describe('coupon helpers', () => {
  it('reads the code at the end of an API error', () => {
    const body = { error: 'conflict', message: 'conflict: coupon_already_held' }
    expect(couponErrorCode(body)).toBe('coupon_already_held')
    expect(couponErrorText(body, t)).toBe('Bạn đang giữ một mã. Hãy dùng hoặc bỏ mã đó trước.')
    expect(couponErrorText({ error: 'gone', message: 'resource gone: tier_sold_out' }, t)).toBe(
      'Mức giảm này vừa hết lượt.',
    )
  })

  it('leaves other errors alone', () => {
    expect(couponErrorCode({ error: 'conflict', message: 'conflict: seats taken' })).toBeUndefined()
    expect(couponErrorText(new Error('offline'), t)).toBeUndefined()
  })

  it('knows which operators a coupon covers', () => {
    expect(coversBrand(coupon, 'b1')).toBe(true)
    expect(coversBrand(coupon, 'b2')).toBe(false)
    expect(coversBrand(coupon, null)).toBe(false)
    expect(coversBrand({ ...coupon, allBrands: true, brands: [] }, 'b2')).toBe(true)
  })
})
