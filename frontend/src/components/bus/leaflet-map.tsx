'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Search, Loader2, MapPin, Crosshair, X, Check } from 'lucide-react'

// ── Fix leaflet's default marker icons (broken under bundlers) ──
// We use custom divIcons instead, so this is just a safety net.
delete (L.Icon.Default.prototype as any)._getIconUrl
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
  extraMarkers?: { lat: number; lon: number; color?: 'blue' | 'red'; label?: string; onClick?: () => void }[]
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
      style={{ background: '#aadaff' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <ZoomControl position="bottomright" />
      {onMapClick && <ClickHandler onPick={onMapClick} />}
      {/* Recenter MUST live inside <MapContainer> so useMap() has a context. */}
      {flyTarget && <Recenter center={flyTarget} zoom={flyZoom} />}
      {marker && (
        <Marker position={[marker.lat, marker.lon]} icon={marker.color === 'red' ? RED_PIN : BLUE_PIN}>
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">{marker.lat.toFixed(4)}, {marker.lon.toFixed(4)}</div>
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

/** Humanise a Tantivy place_type slug for display in search results. */
function formatPlaceType(t: string): string {
  const MAP: Record<string, string> = {
    city: 'Thành phố', town: 'Thị xã', village: 'Xã', hamlet: 'Thôn',
    suburb: 'Khu vực', quarter: 'Phường', neighbourhood: 'Khu phố',
    ward: 'Phường', district: 'Quận/Huyện', province: 'Tỉnh',
    bus_station: 'Bến xe', transit_stop: 'Điểm dừng', rail_station: 'Ga tàu',
    airport: 'Sân bay', road_primary: 'Đường chính', road_secondary: 'Đường phụ',
    road_tertiary: 'Đường nhỏ', road_residential: 'Đường dân cư',
    road_motorway: 'Cao tốc', road_trunk: 'Quốc lộ',
    amenity_school: 'Trường học', amenity_hospital: 'Bệnh viện',
    amenity_university: 'Trường đại học', amenity_college: 'Trường cao đẳng',
    amenity_marketplace: 'Chợ', amenity_townhall: 'UBND',
  }
  if (MAP[t]) return MAP[t]
  // Generic: strip prefix and replace _ with space
  return t.replace(/^(road_|amenity_|tourism_|leisure_|shop_)/, '').replace(/_/g, ' ')
}

/** Search box that queries the Tantivy places index. */
function MapSearchBox({
  onSelect,
  placeholder = 'Tìm thành phố, bến xe…',
}: {
  onSelect: (hit: PlaceHit) => void
  placeholder?: string
}) {
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
      const url = `/api/places/search?limit=6&q=${encodeURIComponent(query)}`
      const res = await fetch(url)
      const data = await res.json()
      setHits(data?.items ?? [])
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
    <div ref={boxRef} className="absolute left-3 top-3 z-1000 w-[min(20rem,calc(100%-1.5rem))]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full h-10 pl-10 pr-9 rounded-lg border border-slate-200 bg-white/95 backdrop-blur shadow-md text-sm outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-blue-600" />
        )}
        {!loading && q && (
          <button
            onClick={() => {
              setQ('')
              setHits([])
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Xóa"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && hits.length > 0 && (
        <ul className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
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
                      : ` (${formatPlaceType(h.type)}, ${h.lat.toFixed(3)}, ${h.lon.toFixed(3)})`}
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
async function reverseGeocode(lat: number, lon: number): Promise<PickedPlace> {
  try {
    const url = `/api/places/reverse?lat=${lat}&lon=${lon}&limit=1`
    const res = await fetch(url)
    const hits: PlaceHit[] = await res.json()
    const h = hits[0]
    if (!h) return { name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon }
    return {
      name: h.name,
      lat: h.lat,
      lon: h.lon,
      type: h.type,
      province: h.province ?? null,
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

export function MapPicker({ pinColor = 'blue', title, initial, onConfirm, onCancel }: MapPickerProps) {
  const [picked, setPicked] = useState<PickedPlace | null>(
    initial ? { name: initial.name ?? 'Vị trí đã chọn', lat: initial.lat, lon: initial.lon } : null,
  )
  const [reverseLoading, setReverseLoading] = useState(false)
  // When the user picks a new location (via search or "my location"), we want
  // the map to fly there. Stored as state (not a ref) so rendering <Recenter>
  // re-runs when it changes.
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(
    initial ? [initial.lat, initial.lon] : null,
  )

  const handleMapClick = useCallback(async (lat: number, lon: number) => {
    setPicked({ name: 'Đang tải tên địa điểm…', lat, lon })
    setReverseLoading(true)
    const place = await reverseGeocode(lat, lon)
    setPicked(place)
    setReverseLoading(false)
  }, [])

  const handleSearchSelect = useCallback((hit: PlaceHit) => {
    const place: PickedPlace = {
      name: hit.name,
      lat: hit.lat,
      lon: hit.lon,
      type: hit.type,
      province: hit.province ?? null,
    }
    setPicked(place)
    setFlyTarget([hit.lat, hit.lon])
  }, [])

  const handleMyLocation = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        setPicked({ name: 'Đang tải tên địa điểm…', lat: latitude, lon: longitude })
        setReverseLoading(true)
        const place = await reverseGeocode(latitude, longitude)
        setPicked(place)
        setReverseLoading(false)
        setFlyTarget([latitude, longitude])
      },
      () => { },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [])

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
        {/* My location button */}
        <button
          onClick={handleMyLocation}
          className="absolute right-3 top-3 z-1000 h-10 w-10 rounded-lg bg-white/95 backdrop-blur shadow-md ring-1 ring-slate-200 flex items-center justify-center text-blue-600 hover:bg-blue-50 transition-colors"
          title="Vị trí của tôi"
          aria-label="Vị trí của tôi"
        >
          <Crosshair className="h-5 w-5" />
        </button>
        {/* Hint overlay */}
        {!picked && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 z-1000 rounded-full bg-slate-900/80 backdrop-blur px-4 py-2 text-xs font-medium text-white shadow-lg">
            <MapPin className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
            Chạm vào bản đồ để chọn vị trí
          </div>
        )}
      </div>

      {/* Footer with picked info + confirm */}
      <div className="border-t bg-white px-4 py-3 flex items-center gap-3">
        <div
          className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center ${pinColor === 'red' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'
            }`}
        >
          {reverseLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <MapPin className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title ?? 'Vị trí đã chọn'}
          </div>
          <div className="text-sm font-medium truncate text-foreground">
            {picked ? picked.name : 'Chưa chọn vị trí'}
          </div>
          {picked && (
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {picked.lat.toFixed(4)}, {picked.lon.toFixed(4)}
            </div>
          )}
        </div>
        <button
          onClick={onCancel}
          className="h-10 px-4 rounded-lg border border-slate-200 text-sm font-medium text-muted-foreground hover:bg-slate-50 transition-colors"
        >
          Hủy
        </button>
        <button
          onClick={() => picked && onConfirm(picked)}
          disabled={!picked || reverseLoading}
          className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm shadow-blue-600/30"
        >
          <Check className="h-4 w-4" />
          Chọn
        </button>
      </div>
    </div>
  )
}

// ── Re-exports for the route map view ───────────────────────
export { LeafletMap as LeafletRouteMap, reverseGeocode, BLUE_PIN, RED_PIN, type PlaceHit }
