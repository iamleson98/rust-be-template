
import { useCallback, useEffect, useRef, useState } from 'react'
import { TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useT } from '@/lib/i18n'

export type BasemapVariant =
  'osm' | 'satellite' | 'hybrid' | 'topo' | 'street' | 'light' | 'dark' | 'natgeo' | 'cyclosm'

type TileSpec = {
  url: string
  attribution: string
  maxNativeZoom: number
  subdomains?: string
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'

const ATTR = {
  osm: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  street:
    'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> &mdash; Source: Esri, HERE, Garmin, USGS, NGA',
  imagery:
    'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  topo: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> &mdash; Source: Esri, USGS, NOAA',
  natgeo:
    'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> &mdash; National Geographic, Esri, Garmin, HERE, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, Increment P',
  gray: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> &mdash; Source: Esri, HERE, DeLorme, USGS, NGA',
  cyclosm:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &mdash; tiles courtesy of <a href="https://www.cyclosm.org/" target="_blank" rel="noopener noreferrer">CyclOSM</a> / OpenStreetMap France',
} as const

/** 1×1 transparent PNG — shown in place of a broken tile icon if a
 *  single tile ever 404s, so the grid stays visually clean. */
const ERROR_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const VARIANTS: Record<BasemapVariant, TileSpec[]> = {
  osm: [
    {
      // Canonical OpenStreetMap raster tiles — the freshest free
      // street data available (community-mapped, refreshed daily).
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: ATTR.osm,
      maxNativeZoom: 19,
    },
  ],
  satellite: [
    {
      url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.imagery,
      maxNativeZoom: 19,
    },
  ],
  hybrid: [
    {
      url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.imagery,
      maxNativeZoom: 19,
    },
    {
      url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.gray,
      maxNativeZoom: 19,
    },
    {
      url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.gray,
      maxNativeZoom: 19,
    },
  ],
  topo: [
    {
      url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.topo,
      maxNativeZoom: 19,
    },
  ],
  street: [
    {
      url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.street,
      maxNativeZoom: 19,
    },
  ],
  light: [
    {
      url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.gray,
      maxNativeZoom: 16,
    },
    {
      url: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.gray,
      maxNativeZoom: 16,
    },
  ],
  dark: [
    {
      url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.gray,
      maxNativeZoom: 16,
    },
    {
      url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.gray,
      maxNativeZoom: 16,
    },
  ],
  natgeo: [
    {
      url: `${ESRI}/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}`,
      attribution: ATTR.natgeo,
      maxNativeZoom: 12,
    },
  ],
  cyclosm: [
    {
      url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      attribution: ATTR.cyclosm,
      maxNativeZoom: 20,
      subdomains: 'abc',
    },
  ],
}

/** i18n keys for the style switcher labels (translated at render time). */
const VARIANT_LABEL_KEYS: Record<BasemapVariant, string> = {
  osm: 'map.style.osm',
  satellite: 'map.style.satellite',
  hybrid: 'map.style.hybrid',
  topo: 'map.style.topo',
  street: 'map.style.street',
  light: 'map.style.light',
  dark: 'map.style.dark',
  natgeo: 'map.style.natgeo',
  cyclosm: 'map.style.cyclosm',
}

const STORAGE_KEY = 'bus_basemap'

function readStoredVariant(fallback: BasemapVariant): BasemapVariant {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && raw in VARIANTS) {
      // Migration: `street` (the old Esri default) was never an
      // explicit user choice worth preserving — remap it to the new
      // OpenStreetMap default so existing users actually see the
      // fresher map data. Anyone who genuinely prefers Esri street
      // can re-pick it from the style switcher (one click).
      if (raw === 'street') return 'osm'
      return raw as BasemapVariant
    }
  } catch {
    /* localStorage unavailable (SSR / privacy mode) — keep fallback */
  }
  return fallback
}

type BasemapLayerProps = {
  /** Basemap style. Defaults to `osm` (or the user's stored pick). */
  variant?: BasemapVariant
  /** Render the compact style switcher (bottom-left). Defaults to true. */
  switcher?: boolean
}

export function BasemapLayer({ variant = 'osm', switcher = true }: BasemapLayerProps) {
  const [active, setActive] = useState<BasemapVariant>(() => readStoredVariant(variant))

  const specs = VARIANTS[active] ?? VARIANTS.osm

  // Stable callback (module-level helper) so the Leaflet control is
  // created exactly once per map instead of on every re-render.
  const onChange = useCallback((v: BasemapVariant) => {
    setActive(v)
    try {
      localStorage.setItem(STORAGE_KEY, v)
    } catch {
      /* ignore storage failures */
    }
  }, [])

  return (
    <>
      {specs.map((spec) => (
        <TileLayer
          key={`${active}:${spec.url}`}
          url={spec.url}
          attribution={spec.attribution}
          maxNativeZoom={spec.maxNativeZoom}
          // Over-zoom gracefully beyond the style's native resolution.
          maxZoom={20}
          // Keep a few off-screen tile rows buffered so panning doesn't
          // flash empty cells while new tiles stream in.
          keepBuffer={4}
          errorTileUrl={ERROR_TILE}
          // Only spread subdomains when the style has them — passing an
          // explicit undefined overrides Leaflet's 'abc' default and
          // crashes getTileUrl (reads .length on undefined).
          {...(spec.subdomains ? { subdomains: spec.subdomains } : {})}
        />
      ))}
      {switcher && <BasemapSwitcher active={active} onChange={onChange} />}
    </>
  )
}

/** Compact style switcher rendered as a Leaflet control in the map's
 *  bottom-left corner: a Layers button that expands into a vertical
 *  list of basemap styles with a checkmark on the active one. Pure
 *  DOM (no portal), so it stays correctly positioned through map
 *  pans/zooms and works inside every LeafletMap surface. */
function BasemapSwitcher({
  active,
  onChange,
}: {
  active: BasemapVariant
  onChange: (v: BasemapVariant) => void
}) {
  const map = useMap()
  const t = useT()
  // Live refs — the Leaflet control below is created once, so it must
  // read the LATEST active/onChange (and translator) instead of the
  // values captured at creation time.
  const activeRef = useRef(active)
  const onChangeRef = useRef(onChange)
  const tRef = useRef(t)
  useEffect(() => {
    activeRef.current = active
    onChangeRef.current = onChange
    tRef.current = t
  }, [active, onChange, t])

  useEffect(() => {
    // Leaflet's typed Control factory: create a bare control and attach
    // our own DOM (L.Control gives us positioning + map lifecycle).
    const control = new L.Control({ position: 'bottomleft' })
    control.onAdd = () => {
      const root = L.DomUtil.create('div', 'vexevn-basemap-switcher')
      root.setAttribute('data-testid', 'basemap-switcher')
      L.DomEvent.disableClickPropagation(root)
      L.DomEvent.disableScrollPropagation(root)

      const button = L.DomUtil.create('button', 'vexevn-basemap-button', root)
      button.type = 'button'
      button.title = tRef.current('map.mapStyle')
      button.setAttribute('aria-label', tRef.current('mapPage.chooseMapStyle'))
      button.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="16.5 9.4 7.5 4.21"/><path d="M2 7v10"/><path d="m2 17 20-10v10"/><path d="M22 17 12 22 2 17"/><path d="m22 7-10 5"/><path d="m12 12-10-5"/></svg>'

      const menu = L.DomUtil.create('div', 'vexevn-basemap-menu', root)
      menu.hidden = true
      menu.setAttribute('role', 'menu')

      const renderItems = () => {
        const current = activeRef.current
        menu.innerHTML = ''
        for (const key of Object.keys(VARIANT_LABEL_KEYS) as BasemapVariant[]) {
          const item = L.DomUtil.create('button', 'vexevn-basemap-item', menu)
          item.type = 'button'
          item.setAttribute('role', 'menuitemradio')
          item.setAttribute('aria-checked', String(key === current))
          if (key === current) item.classList.add('is-active')
          item.innerHTML = `<span class="vexevn-basemap-check">${key === current ? '✓' : ''
            }</span>${tRef.current(VARIANT_LABEL_KEYS[key])}`
          L.DomEvent.on(item, 'click', (e) => {
            L.DomEvent.stop(e)
            onChangeRef.current(key)
            menu.hidden = true
          })
        }
      }
      renderItems()

      button.addEventListener('click', (e) => {
        e.stopPropagation()
        // Re-render on every open so the checkmark always reflects the
        // current style (even when changed from another map instance).
        renderItems()
        menu.hidden = !menu.hidden
      })

      // Close the menu when clicking anywhere else on the map/page.
      const closeOnOutside = (e: MouseEvent) => {
        if (!root.contains(e.target as Node)) menu.hidden = true
      }
      document.addEventListener('click', closeOnOutside)

      control.onRemove = () => {
        document.removeEventListener('click', closeOnOutside)
      }
      return root
    }
    map.addControl(control)
    return () => {
      map.removeControl(control)
    }
    // The control is created exactly once per map; live values flow
    // through refs (see activeRef/onChangeRef above).
  }, [map])

  return null
}
