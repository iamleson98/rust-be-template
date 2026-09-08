/**
 * Tests for the JsonLd component + schema builders.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { JsonLd, buildBreadcrumb, buildTripProduct } from '@/components/seo/json-ld'

describe('JsonLd', () => {
  it('injects a script tag into the document head', () => {
    const data = { '@type': 'Product', name: 'Test' }
    const { unmount } = render(<JsonLd data={data} />)

    const script = document.querySelector('script[data-json-ld="dynamic"]')
    expect(script).not.toBeNull()
    expect(script?.getAttribute('type')).toBe('application/ld+json')

    const parsed = JSON.parse(script!.textContent || '{}')
    expect(parsed['@type']).toBe('Product')
    expect(parsed.name).toBe('Test')

    unmount()
  })

  it('removes the script tag on unmount', () => {
    const data = { '@type': 'Product', name: 'Test' }
    const { unmount } = render(<JsonLd data={data} />)

    expect(document.querySelector('script[data-json-ld="dynamic"]')).not.toBeNull()
    unmount()
    expect(document.querySelector('script[data-json-ld="dynamic"]')).toBeNull()
  })

  it('replaces existing dynamic JSON-LD on re-render', () => {
    const { rerender } = render(<JsonLd data={{ '@type': 'Product', name: 'A' }} />)
    rerender(<JsonLd data={{ '@type': 'Product', name: 'B' }} />)

    const scripts = document.querySelectorAll('script[data-json-ld="dynamic"]')
    expect(scripts).toHaveLength(1)
    const parsed = JSON.parse(scripts[0].textContent || '{}')
    expect(parsed.name).toBe('B')
  })
})

describe('buildBreadcrumb', () => {
  it('builds a valid BreadcrumbList schema', () => {
    const schema = buildBreadcrumb([
      { name: 'Trang chủ', path: '/' },
      { name: 'Tìm chuyến', path: '/search' },
    ])
    expect(schema['@type']).toBe('BreadcrumbList')
    expect(schema.itemListElement).toHaveLength(2)
    expect((schema.itemListElement as any[])[0].position).toBe(1)
    expect((schema.itemListElement as any[])[0].name).toBe('Trang chủ')
  })

  it('includes absolute URLs', () => {
    const schema = buildBreadcrumb([{ name: 'Test', path: '/test' }])
    const item = (schema.itemListElement as any[])[0]
    expect(item.item).toContain('https://')
    expect(item.item).toContain('/test')
  })
})

describe('buildTripProduct', () => {
  it('builds a valid Product schema with offer', () => {
    const schema = buildTripProduct({
      tripId: 'trip-123',
      routeName: 'Hà Nội → Đà Nẵng',
      brandName: 'Phương Trang',
      price: 350000,
      currency: 'VND',
      url: 'https://datxevui.vn/trips/trip-123',
    })
    expect(schema['@type']).toBe('Product')
    expect(schema.name).toBe('Hà Nội → Đà Nẵng')
    expect((schema.brand as any).name).toBe('Phương Trang')
    expect((schema.offers as any).price).toBe(350000)
    expect((schema.offers as any).priceCurrency).toBe('VND')
    expect((schema.offers as any).availability).toContain('InStock')
  })
})
