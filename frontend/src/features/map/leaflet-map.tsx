'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { MapContainer, Marker, Popup, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Search, Loader2, MapPin, Crosshair, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { search as sdkPlaceSearch, reverse as sdkReverseGeocode } from '@/lib/api/sdk.gen'
import { useT } from '@/lib/i18n'
import { BasemapLayer } from '@/features/map/basemap-layer'
import {
  useMyLocation,
  type MyLocationErrorCode,
  type MyLocation,
} from '@/features/map/use-my-location'

// ── Fix leaflet's default marker icons (broken under bundlers) ──
// We use custom divIcons instead, so this is just a safety net.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export type PickedPlace = {
  name: string
  lat: number
  lon: number
  type?: string
  province?: string | null
  district?: string | null
}

type PlaceHit = {
  osmId: number
  name: string
  type: string
  province?: string | null
  district?: string | null
  lat: number
  lon: number
}

// Centered on Vietnam
const VIETNAM_CENTER: [number, number] = [16.0, 106.0]
const DEFAULT_ZOOM = 6

/** Build a colored pin divIcon (so we don't depend on image assets). */
function pinIcon(color: string, filled = true): L.DivIcon {
  const svg = filled
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3" fill="white" stroke="none"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`
  return L.divIcon({
    html: svg,
    className: 'vexevn-pin',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  })
}

const BLUE_PIN = pinIcon('#2563eb')
const RED_PIN = pinIcon('#dc2626')

/** Component that recenters the map when `center` prop changes. */
function Recenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap()
  useEffect(() => {
    // Refresh the container geometry BEFORE animating: the map may live
    // inside a dialog whose opening animation changed the container size
    // after init. Flying from stale geometry is the classic "ends up in
    // the wrong place" Leaflet race (invalidateSize mid-flight corrects
    // the pixel origin with a compensating pan, corrupting the target).
    // With `pan: false` we recompute the size without the compensating
    // pan, then fly to the requested center deterministically. The call
    // is a no-op (early return) when the size already matches.
    map.invalidateSize({ animate: false, pan: false })
    map.flyTo(center, zoom ?? map.getZoom(), { duration: 0.8 })
  }, [center, zoom, map])
  return null
}

/** Click-to-select handler. */
function ClickHandler({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

type LeafletMapProps = {
  initialCenter?: [number, number]
  initialZoom?: number
  /** Marker to show (the picked location). */
  marker?: { lat: number; lon: number; color?: 'blue' | 'red' } | null
  /** Optional extra markers (e.g. city pins). */
  extraMarkers?: {
    lat: number
    lon: number
    color?: 'blue' | 'red'
    label?: string
    onClick?: () => void
  }[]
  /** Called when the user clicks an empty area of the map. */
  onMapClick?: (lat: number, lon: number) => void
  /** When set, the map will fly to this [lat, lon]. Must be inside MapContainer, so handled here. */
  flyTarget?: [number, number] | null
  /** Zoom level to use when flying. */
  flyZoom?: number
  /** Controlled search query (forwarded from parent). */
  className?: string
}

export function LeafletMap({
  initialCenter = VIETNAM_CENTER,
  initialZoom = DEFAULT_ZOOM,
  marker,
  extraMarkers,
  onMapClick,
  flyTarget,
  flyZoom,
  className,
}: LeafletMapProps) {
  return (
    <MapContainer
      center={initialCenter}
      zoom={initialZoom}
      scrollWheelZoom
      zoomControl={false}
      className={className ?? 'h-full w-full'}
      style={{ background: '#e2eaf2' }}
    >
      <BasemapLayer />
      <ZoomControl position="bottomright" />
      <FixSize />
      {onMapClick && <ClickHandler onPick={onMapClick} />}
      {flyTarget && <Recenter center={flyTarget} zoom={flyZoom} />}
      {marker && (
        <Marker
          position={[marker.lat, marker.lon]}
          icon={marker.color === 'red' ? RED_PIN : BLUE_PIN}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">
                {marker.lat.toFixed(4)}, {marker.lon.toFixed(4)}
              </div>
            </div>
          </Popup>
        </Marker>
      )}
      {extraMarkers?.map((m, i) => (
        <Marker
          key={i}
          position={[m.lat, m.lon]}
          icon={m.color === 'red' ? RED_PIN : BLUE_PIN}
          eventHandlers={m.onClick ? { click: m.onClick } : undefined}
        >
          {m.label && (
            <Popup>
              <div className="text-sm font-medium">{m.label}</div>
            </Popup>
          )}
        </Marker>
      ))}
    </MapContainer>
  )
}

/** i18n keys for humanising Tantivy place_type slugs in search results. */
const PLACE_TYPE_KEYS: Record<string, string> = {
  city: 'mapPage.ptCity',
  town: 'mapPage.ptTown',
  village: 'mapPage.ptVillage',
  hamlet: 'mapPage.ptHamlet',
  suburb: 'mapPage.ptSuburb',
  quarter: 'mapPage.ptWard',
  neighbourhood: 'mapPage.ptNeighbourhood',
  ward: 'mapPage.ptWard',
  district: 'mapPage.ptDistrict',
  province: 'mapPage.ptProvince',
  bus_station: 'mapPage.ptBusStation',
  transit_stop: 'mapPage.ptTransitStop',
  rail_station: 'mapPage.ptRailStation',
  airport: 'mapPage.ptAirport',
  road_primary: 'mapPage.ptRoadPrimary',
  road_secondary: 'mapPage.ptRoadSecondary',
  road_tertiary: 'mapPage.ptRoadTertiary',
  road_residential: 'mapPage.ptRoadResidential',
  road_motorway: 'mapPage.ptMotorway',
  road_trunk: 'mapPage.ptTrunk',
  amenity_school: 'mapPage.ptSchool',
  amenity_hospital: 'mapPage.ptHospital',
  amenity_university: 'mapPage.ptUniversity',
  amenity_college: 'mapPage.ptCollege',
  amenity_marketplace: 'mapPage.ptMarket',
  amenity_townhall: 'mapPage.ptTownhall',
}

/** Humanise a Tantivy place_type slug for display in search results. */
function formatPlaceType(type: string, t: ReturnType<typeof useT>): string {
  const key = PLACE_TYPE_KEYS[type]
  if (key) return t(key)
  // Generic: strip prefix and replace _ with space
  return type.replace(/^(road_|amenity_|tourism_|leisure_|shop_)/, '').replace(/_/g, ' ')
}

/** Search box that queries the Tantivy places index. */
function MapSearchBox({
  onSelect,
  placeholder,
}: {
  onSelect: (hit: PlaceHit) => void
  placeholder?: string
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const boxRef = useRef<HTMLDivElement>(null)

  const run = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setHits([])
      return
    }
    setLoading(true)
    try {
      const { data } = await sdkPlaceSearch({ query: { q: query, limit: 6 } })
      setHits(((data ?? {}) as { items?: PlaceHit[] }).items ?? [])
    } catch {
      setHits([])
    } finally {
      setLoading(false)
    }
  }, [])

  const onInput = (v: string) => {
    setQ(v)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => run(v), 350)
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={boxRef} className="absolute left-3 top-3 z-1000 w-[min(20rem,calc(100%-7rem))]">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-600"
          strokeWidth={2.5}
        />
        <input
          value={q}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? t('mapPage.searchPlaceholder')}
          className="w-full h-11 pl-11 pr-10 rounded-lg border border-slate-200 bg-white/95 backdrop-blur text-sm outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
        />
        {loading && (
          <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-blue-600" />
        )}
        {!loading && q && (
          <button
            onClick={() => {
              setQ('')
              setHits([])
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={t('mapPage.clear')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && hits.length > 0 && (
        <ul className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {hits.map((h) => (
            <li key={h.osmId}>
              <button
                type="button"
                onClick={() => {
                  onSelect(h)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-blue-50 transition-colors"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <span className="line-clamp-2 text-foreground">
                  {h.name}
                  <span className="text-muted-foreground">
                    {h.province
                      ? `, ${h.province}`
                      : ` (${formatPlaceType(h.type, t)}, ${h.lat.toFixed(3)}, ${h.lon.toFixed(3)})`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Reverse geocode helper (Tantivy) ────────────────────────
// Returns a PickedPlace with the NAME of the nearest known place
// (for display) but keeps the EXACT lat/lon the user clicked (so
// the marker doesn't jump to a nearby indexed place).
async function reverseGeocode(lat: number, lon: number): Promise<PickedPlace> {
  try {
    const { data } = await sdkReverseGeocode({ query: { lat, lon, limit: 1 } })
    const hits: PlaceHit[] = (data ?? []) as PlaceHit[]
    const h = hits[0]
    if (!h) return { name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon }
    return {
      name: h.name,
      // Keep the EXACT clicked coordinates — NOT h.lat/h.lon (which is
      // the nearest indexed place, potentially hundreds of meters away).
      lat,
      lon,
      type: h.type,
      province: h.province,
      district: h.district,
    }
  } catch {
    return { name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon }
  }
}

// ── Full Map Picker (used inside a Dialog) ──────────────────
type MapPickerProps = {
  /** Color of the picked-location pin. */
  pinColor?: 'blue' | 'red'
  /** Title shown in the search box header. */
  title?: string
  /** Optional initial marker. */
  initial?: { lat: number; lon: number; name?: string } | null
  onConfirm: (place: PickedPlace) => void
  onCancel: () => void
}

export function MapPicker({
  pinColor = 'blue',
  title,
  initial,
  onConfirm,
  onCancel,
}: MapPickerProps) {
  const t = useT()
  const [picked, setPicked] = useState<PickedPlace | null>(
    initial
      ? { name: initial.name ?? t('map.selectedLocation'), lat: initial.lat, lon: initial.lon }
      : null,
  )
  const [reverseLoading, setReverseLoading] = useState(false)
  // GPS accuracy of the current pick (meters) — set when the pick came
  // from the "my location" button, null otherwise (manual/search picks
  // are exact coordinates with no accuracy radius).
  const [pickedAccuracy, setPickedAccuracy] = useState<number | null>(null)
  // When the user picks a new location (via search or "my location"), we want
  // the map to fly there. Stored as state (not a ref) so rendering <Recenter>
  // re-runs when it changes.
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(
    initial ? [initial.lat, initial.lon] : null,
  )

  // Progressive-accuracy GPS acquisition (see use-my-location.ts). The old
  // one-shot getCurrentPosition flew the map to whatever coarse Wi-Fi/cell
  // fix arrived first — frequently hundreds of meters to kilometers away
  // from the user — which is exactly the "jumps to the wrong position" bug.
  // Results arrive via a callback (ref-backed inside the hook) so a fresh
  // translator closure per render can never re-trigger the fix handler.
  const handleLocated = useCallback(
    (loc: MyLocation) => {
      const { lat, lon, accuracy } = loc
      setPickedAccuracy(Number.isFinite(accuracy) ? accuracy : null)
      setPicked({ name: t('map.loadingPlaceName'), lat, lon })
      setReverseLoading(true)
      setFlyTarget([lat, lon])
      // A poor fix (accuracy > 1 km) still flies but tells the user how
      // coarse it is, instead of silently presenting a wrong position as
      // exact.
      if (Number.isFinite(accuracy) && accuracy > 1000) {
        toast.warning(t('mapPage.lowAccuracy', { m: Math.round(accuracy) }))
      }
      reverseGeocode(lat, lon).then((place) => {
        setPicked(place)
        setReverseLoading(false)
      })
    },
    [t],
  )

  const handleLocateError = useCallback(
    (code: MyLocationErrorCode) => {
      toast.error(
        code === 'unavailable'
          ? t('mapPage.noGeolocation')
          : code === 'denied'
            ? t('mapPage.locationDenied')
            : t('map.cannotLocate'),
        { description: t('mapPage.cannotLocateDesc') },
      )
    },
    [t],
  )

  const {
    acquiring: gpsAcquiring,
    locate: locateMe,
    cancel: cancelLocate,
  } = useMyLocation(handleLocated, handleLocateError)

  const handleMapClick = useCallback(
    async (lat: number, lon: number) => {
      // The user is manually choosing a spot — cancel any in-flight GPS
      // acquisition so a late fix can't clobber their explicit choice.
      cancelLocate()
      setPickedAccuracy(null)
      setPicked({ name: t('map.loadingPlaceName'), lat, lon })
      setReverseLoading(true)
      const place = await reverseGeocode(lat, lon)
      setPicked(place)
      setReverseLoading(false)
    },
    [t, cancelLocate],
  )

  const handleSearchSelect = useCallback(
    (hit: PlaceHit) => {
      cancelLocate()
      setPickedAccuracy(null)
      const place: PickedPlace = {
        name: hit.name,
        lat: hit.lat,
        lon: hit.lon,
        type: hit.type,
        province: hit.province ?? null,
      }
      setPicked(place)
      setFlyTarget([hit.lat, hit.lon])
    },
    [cancelLocate],
  )

  return (
    <div className="flex flex-col h-[70vh] md:h-[75vh]">
      {/* Map area */}
      <div className="relative flex-1 min-h-0">
        <LeafletMap
          className="h-full w-full"
          initialCenter={initial ? [initial.lat, initial.lon] : VIETNAM_CENTER}
          initialZoom={initial ? 13 : DEFAULT_ZOOM}
          marker={picked ? { lat: picked.lat, lon: picked.lon, color: pinColor } : null}
          onMapClick={handleMapClick}
          flyTarget={flyTarget}
          flyZoom={13}
        />
        <MapSearchBox onSelect={handleSearchSelect} />
        {/* My location button — spinner while the GPS radio converges
            (feedback prevents the tap-tap-tap "nothing happened" double
            taps that used to queue conflicting jumps). */}
        <button
          onClick={locateMe}
          disabled={gpsAcquiring}
          className="absolute right-3 top-3 z-1000 h-11 w-11 rounded-lg bg-white/95 backdrop-blur ring-1 ring-slate-200 flex items-center justify-center text-blue-600 hover:bg-blue-50 disabled:cursor-wait transition-colors"
          title={gpsAcquiring ? t('mapPage.locating') : t('map.myLocation')}
          aria-label={gpsAcquiring ? t('mapPage.locating') : t('map.myLocation')}
        >
          {gpsAcquiring ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Crosshair className="h-5 w-5" />
          )}
        </button>
        {/* Hint overlay */}
        {!picked && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 z-1000 rounded-full bg-slate-900/80 backdrop-blur px-4 py-2 text-xs font-medium text-white">
            <MapPin className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
            {t('map.clickToPick')}
          </div>
        )}
      </div>

      {/* Footer with picked info + confirm */}
      <div className="border-t bg-white px-4 py-3 flex items-center gap-3">
        <div
          className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center ${pinColor === 'red' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'
            }`}
        >
          {reverseLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <MapPin className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title ?? t('map.selectedLocation')}
          </div>
          <div className="text-sm font-medium truncate text-foreground">
            {picked ? picked.name : t('map.noLocationYet')}
          </div>
          {picked && (
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {picked.lat.toFixed(4)}, {picked.lon.toFixed(4)}
              {pickedAccuracy != null && (
                <span className="ml-1.5" title={t('mapPage.accuracyHint')}>
                  ±{Math.max(1, Math.round(pickedAccuracy))} m
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onCancel}
          className="h-10 px-4 rounded-lg border border-slate-200 text-sm font-medium text-muted-foreground hover:bg-slate-50 transition-colors"
        >
          {t('mapPage.cancel')}
        </button>
        <button
          onClick={() => picked && onConfirm(picked)}
          disabled={!picked || reverseLoading}
          className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Check className="h-4 w-4" />
          {t('mapPage.select')}
        </button>
      </div>
    </div>
  )
}

// ── Re-exports for the route map view ───────────────────────
export { LeafletMap as LeafletRouteMap, reverseGeocode, BLUE_PIN, RED_PIN, type PlaceHit }

/** Fix leaflet's tile rendering when the container mounts inside a
 *  dynamically-sized wrapper (an animating Dialog, a swapping layout).
 *  Leaflet measures the container size at init time, which can be
 *  stale — we keep calling invalidateSize until the container reports
 *  a stable size, and observe later resizes. Extracted from
 *  route-map-inner.tsx so dialog-mounted maps (AddressMapDialog,
 *  MapPicker) get the same treatment. */
function FixSize() {
  const map = useMap()
  useEffect(() => {
    let lastW = 0
    let lastH = 0
    let stable = 0
    const tick = () => {
      const el = map.getContainer()
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w === lastW && h === lastH && w > 0 && h > 0) {
        stable++
        if (stable === 1) {
          // First time stable — invalidate to lock the size.
          map.invalidateSize()
        }
        if (stable > 8) {
          // Container has been stable for a while — stop polling.
          clearInterval(timer)
        }
      } else {
        stable = 0
        map.invalidateSize()
      }
      lastW = w
      lastH = h
    }
    const timer = setInterval(tick, 100)
    tick()
    // Also observe resize events on the container.
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => {
      clearInterval(timer)
      ro.disconnect()
    }
  }, [map])
  return null
}
