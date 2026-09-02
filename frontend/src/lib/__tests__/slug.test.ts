import { describe, expect, it } from 'vitest'

import { slugify } from '../slug'

describe('slugify', () => {
  it('strips Vietnamese diacritics', () => {
    expect(slugify('Giường nằm')).toBe('giuong-nam')
    expect(slugify('Xe 45 chỗ')).toBe('xe-45-cho')
  })

  it('lowercases and collapses separators', () => {
    expect(slugify('  Limousine -- VIP  ')).toBe('limousine-vip')
  })

  it('replaces đ/Đ explicitly (NFD does not decompose them)', () => {
    expect(slugify('Đà Nẵng')).toBe('da-nang')
  })

  it('drops leading/trailing dashes and non-alphanumerics', () => {
    expect(slugify('---')).toBe('')
    expect(slugify('a.b')).toBe('a-b')
  })
})
