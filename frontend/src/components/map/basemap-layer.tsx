'use client'

/**
 * BasemapLayer — CARTO raster basemaps rendered as native Leaflet
 * TileLayers (https://carto.com/basemaps/).
 *
 * Why raster CARTO (replacing the OpenFreeMap vector experiment):
 * OpenFreeMap serves MapLibre vector-tile styles, which we bridged
 * into Leaflet via `@maplibre/maplibre-gl-leaflet`. That bridge renders
 * on a WebGL canvas that Leaflet drags around with CSS transforms, so
 * during pan/zoom the canvas desyncs from Leaflet's tile grid — tiles
 * appear blank, blurry or half-loaded, the canvas smears mid-animation,
 * and it ships a ~950KB `vendor-maplibre` chunk before anything paints.
 * CARTO's raster tiles (`basemaps.cartocdn.com`) are painted by
 * Leaflet's own battle-tested `<img>` tile pipeline: every tile is an
 * independent image loaded from a global 4-subdomain CDN, so panning,
 * zooming and resizing stay perfectly in sync and tiles stream in
 * progressively. No API key, no WebGL, no bridge, no extra vendor
 * chunk beyond Leaflet itself.
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
