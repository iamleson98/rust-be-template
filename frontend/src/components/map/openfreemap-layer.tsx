'use client'

/**
 * OpenFreeMapLayer — the OpenFreeMap (openfreemap.org) vector basemap
 * rendered as a Leaflet layer.
 *
 * OpenFreeMap serves MapLibre vector-tile styles only (no raster
 * hosting), so we bridge them into Leaflet with
 * `@maplibre/maplibre-gl-leaflet`: a MapLibre GL canvas renders the
 * style inside Leaflet's tile pane while every existing Leaflet
 * feature (markers, polylines, popups, click handlers, zoom
 * controls) keeps working unchanged.
 *
 * Default style: `liberty` — the detailed, colourful style closest to
 * the previous CARTO Voyager basemap. Alternatives: `bright`,
 * `positron`, `dark`, `fiord` (https://tiles.openfreemap.org/styles/<name>).
 *
 * Attribution (required by OpenFreeMap's terms) is surfaced through
 * Leaflet's attribution control via the layer's
 * `attributionControl.customAttribution` option.
 *
 * Client-only: both Leaflet and MapLibre touch `window`, so this
 * component must stay inside the lazily-imported map bundles.
 */

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import type { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@maplibre/maplibre-gl-leaflet'

/** OpenFreeMap style endpoint (MapLibre style JSON). */
export const OPENFREEMAP_LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

/** Required attribution — openfreemap.org/ (Attribution section). */
export const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> · data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'

type OpenFreeMapLayerProps = {
  /** MapLibre style URL or style object. Defaults to OpenFreeMap liberty. */
  style?: string | StyleSpecification
}

export function OpenFreeMapLayer({ style = OPENFREEMAP_LIBERTY_STYLE }: OpenFreeMapLayerProps) {
  const map = useMap()

  useEffect(() => {
    // `interactive: false` — Leaflet stays the interaction layer; the GL
    // canvas only paints. Vector tiles overzoom beyond their maxzoom,
    // so Leaflet's own zoom range applies.
    const layer = L.maplibreGL({
      style,
      attributionControl: { customAttribution: OPENFREEMAP_ATTRIBUTION },
      interactive: false,
    })
    layer.addTo(map)
    return () => {
      layer.remove()
    }
  }, [map, style])

  return null
}
