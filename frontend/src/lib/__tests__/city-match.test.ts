import { describe, expect, it } from 'vitest'
import { cityForProvince } from '@/lib/city-match'
import { VIETNAMESE_CITIES } from '@/lib/vietnamese-cities'

describe('cityForProvince', () => {
  it("maps the place search's province names onto one of our cities", () => {
    expect(cityForProvince('Hà Nội')).toBe('ha-noi')
    expect(cityForProvince('TP. Hồ Chí Minh')).toBe('ho-chi-minh')
    expect(cityForProvince('Thành phố Hồ Chí Minh')).toBe('ho-chi-minh')
    expect(cityForProvince('Thành phố Huế')).toBe('hue')
    expect(cityForProvince('Tỉnh Lâm Đồng')).toBe('lam-dong')
    expect(cityForProvince('Bà Rịa - Vũng Tàu')).toBe('ba-ria-vung-tau')
    expect(cityForProvince('Hưng Yên')).toBe('hung-yen')
  })

  it('understands colloquial names and unaccented spelling', () => {
    expect(cityForProvince('Sài Gòn')).toBe('ho-chi-minh')
    expect(cityForProvince('Da Nang')).toBe('da-nang')
    expect(cityForProvince('Đà Lạt')).toBe('lam-dong')
  })

  it('is none for an unknown, empty or ambiguous name', () => {
    expect(cityForProvince('Atlantis')).toBeNull()
    expect(cityForProvince('')).toBeNull()
    expect(cityForProvince('   ')).toBeNull()
    expect(cityForProvince(null)).toBeNull()
    expect(cityForProvince(undefined)).toBeNull()
    expect(cityForProvince('Giang')).toBeNull() // Hà Giang, Bắc Giang, Kiên Giang, …
  })

  it('knows every city by its own name', () => {
    for (const c of VIETNAMESE_CITIES) expect(cityForProvince(c.name)).toBe(c.id)
  })

  it('lists the 63 first-level divisions with unique slugs', () => {
    expect(VIETNAMESE_CITIES).toHaveLength(63)
    const slugs = VIETNAMESE_CITIES.map((c) => c.id)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z-]+$/)
    expect(cityForProvince('Hải Dương')).toBe('hai-duong')
  })
})
