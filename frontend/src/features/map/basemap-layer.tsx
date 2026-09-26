'use client'

/**
 * BasemapLayer — CARTO raster basemaps rendered as native Leaflet
 * TileLayers (https://carto.com/basemaps/).
 *
 * TILE-SERVICE RESEARCH (2026-09, fixing "map doesn't render
 * properly"): candidates for a free, beautiful, no-payment tile
 * provider —
 *   * tile.openstreetmap.org  — free but a strict usage policy (bulk
 *     rendering limits, requires valid HTTP referer); unsuitable as a
 *     product basemap.
 *   * Stadia/Stamen tiles      — beautiful, but require a registered
 *     API key since 2023 (payment tier for scale). Disqualified.
 *   * MapTiler / Thunderforest — key + paid tiers. Disqualified.
 *   * OpenFreeMap              — genuinely free vector tiles, no key,
 *     no rate limit. Tried before: the @maplibre/maplibre-gl-leaflet
 *     bridge renders on a WebGL canvas that desyncs from Leaflet's
 *     tile grid during pan/zoom (blank/blurry tiles, canvas smearing)
 *     and ships a ~950KB vendor chunk. Reverted.
 *   * CARTO basemaps (CURRENT) — free public raster basemaps, no API
 *     key, no signup, no payment, served from a global 4-subdomain
 *     CDN (a-d), effectively no rate limit for a website at this
 *     scale, attribution-only terms. The voyager style is the classic
 *     consumer-mapping look. Verified reachable + fast (200, ~2KB per
 *     tile, ~150ms).
 * The actual render bug in dialogs was Leaflet measuring the container
 * mid-animation — fixed by the FixSize component in leaflet-map.tsx.
 *
 * Variants:
 *   - `voyager`  (default) — detailed and colourful, the classic
 *     consumer-mapping look; best for the public route map.
 *   - `positron` — light, minimal; ideal under dense data overlays.
 *   - `dark`     — dark matter; dashboards and night mode.
 *
 * Retina: Leaflet replaces the `{r}` placeholder with `@2x` on
 * HiDPI screens automatically (L.Browser.retina), so crisp labels on
 * phones/macbooks at zero config.
 *
 * Attribution (CARTO terms): "© OpenStreetMap contributors © CARTO"
 * rendered through Leaflet's attribution control.
 */

import { TileLayer } from 'react-leaflet'

export type BasemapVariant = 'voyager' | 'positron' | 'dark'

/** Required attribution — https://carto.com/attributions/ */
export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>'

const VARIANTS: Record<BasemapVariant, { url: string; maxZoom: number }> = {
  voyager: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    maxZoom: 20,
  },
  positron: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/positron/{z}/{x}/{y}{r}.png',
    maxZoom: 20,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_matter/{z}/{x}/{y}{r}.png',
    maxZoom: 20,
  },
}

type BasemapLayerProps = {
  /** Basemap look. Defaults to `voyager`. */
  variant?: BasemapVariant
}

export function BasemapLayer({ variant = 'voyager' }: BasemapLayerProps) {
  const v = VARIANTS[variant]
  return (
    <TileLayer
      url={v.url}
      attribution={CARTO_ATTRIBUTION}
      // CARTO's raster CDN has four load-balanced subdomains (a-d).
      subdomains="abcd"
      maxZoom={v.maxZoom}
      // Keep a few off-screen tile rows buffered so panning doesn't
      // flash empty cells while new tiles stream in.
      keepBuffer={4}
    />
  )
}
