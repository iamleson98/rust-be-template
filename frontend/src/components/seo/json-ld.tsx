/**
 * JsonLd — injects a `<script type="application/ld+json">` tag into
 * `<head>` for per-route structured data.
 *
 * Usage:
 *   <JsonLd data={{ "@context": "https://schema.org", "@type": "Product", ... }} />
 *
 * The script tag is removed on unmount so it doesn't leak across routes.
 *
 * ## Why per-route?
 *
 * The homepage has static JSON-LD (WebSite, Organization, FAQPage) baked
 * into `index.html` at build time. But dynamic pages (trip detail, brand
 * detail, booking detail) need per-route schemas:
 *   - `/trips/$id` → `Product` (bus ticket with price + availability)
 *   - `/brands/$slug` → `Organization` (brand-specific)
 *   - `/bookings/$code` → no schema (private page, not indexed)
 *
 * These dynamic schemas are injected client-side by this component.
 * Google's crawler executes JavaScript, so client-side JSON-LD IS
 * indexed (confirmed by Google in 2023).
 */

import { useEffect } from 'react'

type JsonLdData = Record<string, unknown>

export function JsonLd({ data }: { data: JsonLdData }) {
  useEffect(() => {
    if (typeof document === 'undefined') return

    const script = document.createElement('script')
    script.type = 'application/ld+json'
    // Use a stable id so re-renders replace the existing tag instead
    // of stacking duplicates.
    script.setAttribute('data-json-ld', 'dynamic')
    script.textContent = JSON.stringify(data)

    // Remove any previous dynamic JSON-LD before adding the new one.
    const existing = document.querySelector('script[data-json-ld="dynamic"]')
    if (existing) existing.remove()

    document.head.appendChild(script)

    return () => {
      // Clean up on unmount (route change).
      script.remove()
    }
  }, [data])

  return null
}

// ── Pre-built schema generators ────────────────────────────────

/**
 * Build a `BreadcrumbList` schema for the current route.
 *
 * Usage:
 *   <JsonLd data={buildBreadcrumb([
 *     { name: 'Trang chủ', path: '/' },
 *     { name: 'Tìm chuyến', path: '/search' },
 *     { name: 'Hà Nội → Đà Nẵng', path: '/trips/abc' },
 *   ])} />
 */
export function buildBreadcrumb(
  items: Array<{ name: string; path: string }>,
): JsonLdData {
  const baseUrl = 'https://vexevn.vn'
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${baseUrl}${item.path}`,
    })),
  }
}

/**
 * Build a `Product` schema for a bus trip (for trip detail pages).
 *
 * This gives Google rich results with price + availability + brand.
 */
export function buildTripProduct(params: {
  tripId: string
  routeName: string
  brandName: string
  price: number
  currency: string
  url: string
}): JsonLdData {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: params.routeName,
    brand: {
      '@type': 'Brand',
      name: params.brandName,
    },
    offers: {
      '@type': 'Offer',
      price: params.price,
      priceCurrency: params.currency,
      availability: 'https://schema.org/InStock',
      url: params.url,
    },
  }
}
