'use client'

import { useEffect, useMemo } from 'react'
import {
  MapContainer,
  Polyline,
  CircleMarker,
  Tooltip as LeafletTooltip,
  Popup,
  useMap,
  ZoomControl,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, Bus, ArrowRight, Search } from 'lucide-react'
import { formatVND } from '@/lib/types'
import { BasemapLayer } from '@/features/map/basemap-layer'

// Fix default icon paths (safety net; we mostly use CircleMarker / divIcon)
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export type RoutePlace = {
  id: string
  name: string
  type: string
  province: string | null
  lat: number
  lon: number
  population: number
}

export type RouteItem = {
  id: string
  slug: string
  name: string
  code: string
  brand: { name: string; slug: string; accentColor: string; logoUrl: string | null; rating: number }
  from: { name: string; lat: number; lon: number }
  to: { name: string; lat: number; lon: number }
  scheduleCount: number
  minPrice: number
  maxPrice: number
}

type RouteMapInnerProps = {
  places: RoutePlace[]
  routes: RouteItem[]
  cityStats: Map<string, { count: number; dests: Map<string, number> }>
  selectedCity: { place: RoutePlace; routeCount: number; popularDests: string[] } | null
  selectedRoute: RouteItem | null
  onSelectCity: (p: RoutePlace) => void
  onSelectRoute: (r: RouteItem) => void
  flyTo: { lat: number; lon: number; zoom?: number; key: number } | null
}

const VIETNAM_CENTER: [number, number] = [16.5, 107.0]

/** Fly the map to a target whenever `flyTo` changes. */
function FlyToController({ flyTo }: { flyTo: RouteMapInnerProps['flyTo'] }) {
  const map = useMap()
  useEffect(() => {
    if (!flyTo) return
    map.flyTo([flyTo.lat, flyTo.lon], flyTo.zoom ?? 8, { duration: 0.9 })
  }, [flyTo, map])
  return null
}

/** Dashed gradient-ish polyline using two layers (solid faint + dashed bright). */
function RouteLine({
  route,
  isSelected,
  onClick,
}: {
  route: RouteItem
  isSelected: boolean
  onClick: () => void
}) {
  const positions: [number, number][] = [
    [route.from.lat, route.from.lon],
    [route.to.lat, route.to.lon],
  ]
  return (
    <>
      {/* Wide invisible hit area */}
      <Polyline
        positions={positions}
        pathOptions={{ color: 'transparent', weight: 14 }}
        eventHandlers={{ click: onClick }}
      />
      {/* Visible line — dashed in brand color */}
      <Polyline
        positions={positions}
        pathOptions={{
          color: route.brand.accentColor,
          weight: isSelected ? 5 : 3,
          opacity: isSelected ? 1 : 0.75,
          dashArray: '7 5',
          lineCap: 'round',
        }}
        eventHandlers={{ click: onClick }}
      />
    </>
  )
}

export function RouteMapInner({
  places,
  routes,
  cityStats,
  selectedCity,
  selectedRoute,
  onSelectCity,
  onSelectRoute,
  flyTo,
}: RouteMapInnerProps) {
  // Compute bounds of all places once, to fit the map to Vietnam.
  const bounds = useMemo(() => {
    if (places.length === 0) return null
    const lats = places.map((p) => p.lat)
    const lons = places.map((p) => p.lon)
    return L.latLngBounds(
      [Math.min(...lats) - 1, Math.min(...lons) - 1],
      [Math.max(...lats) + 1, Math.max(...lons) + 1],
    )
  }, [places])

  return (
    <MapContainer
      center={VIETNAM_CENTER}
      zoom={6}
      scrollWheelZoom
      zoomControl={false}
      className="h-full w-full"
      style={{ background: '#e2eaf2' }}
    >
      <BasemapLayer />
      <ZoomControl position="bottomright" />
      <FixSize />
      <FlyToController flyTo={flyTo} />

      {bounds && <FitBounds bounds={bounds} />}

      {/* Routes */}
      {routes.map((r) => (
        <RouteLine
          key={r.id}
          route={r}
          isSelected={selectedRoute?.id === r.id}
          onClick={() => onSelectRoute(r)}
        />
      ))}

      {/* City markers */}
      {places.map((p) => {
        const stats = cityStats.get(p.name)
        const routeCount = stats?.count ?? 0
        const isBigCity = p.type === 'city' && p.population > 500000
        const isSelected = selectedCity?.place.id === p.id
        const radius = isBigCity ? 7 : routeCount > 0 ? 5.5 : 4
        const stroke = routeCount > 0 ? '#2563eb' : '#94a3b8'
        return (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={radius}
            pathOptions={{
              color: isSelected ? '#2563eb' : stroke,
              weight: isBigCity ? 3 : 2,
              fillColor: isSelected ? '#2563eb' : '#ffffff',
              fillOpacity: isSelected ? 0.9 : 1,
            }}
            eventHandlers={{ click: () => onSelectCity(p) }}
          >
            {(isBigCity || isSelected) && (
              <LeafletTooltip direction="top" offset={[0, -radius]} opacity={1}>
                <span className="text-xs font-semibold text-slate-800">{p.name}</span>
              </LeafletTooltip>
            )}
            <Popup>
              <div className="min-w-45">
                <div className="flex items-center gap-1.5 mb-1">
                  <MapPin className="h-3.5 w-3.5 text-blue-600" />
                  <span className="font-bold text-sm">{p.name}</span>
                </div>
                {p.province && (
                  <div className="text-[11px] text-slate-500 mb-1.5">{p.province}</div>
                )}
                <div className="flex items-center gap-3 text-xs">
                  <span>
                    <b className="text-blue-700">{routeCount}</b> tuyến
                  </span>
                  {stats && stats.dests.size > 0 && (
                    <span>
                      <b className="text-amber-600">{stats.dests.size}</b> điểm đến
                    </span>
                  )}
                </div>
                {stats && stats.dests.size > 0 && (
                  <button
                    onClick={() => onSelectCity(p)}
                    className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-md bg-blue-600 text-white text-xs font-medium py-1.5 hover:bg-blue-700 transition-colors"
                  >
                    <Search className="h-3 w-3" />
                    Xem chi tiết
                  </button>
                )}
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {/* Selected route popup at midpoint */}
      {selectedRoute && (
        <Popup position={[(selectedRoute.from.lat + selectedRoute.to.lat) / 2, (selectedRoute.from.lon + selectedRoute.to.lon) / 2]} closeButton={false}>
          <div className="min-w-55">
            <div
              className="h-1.5 w-full rounded-full mb-2"
              style={{ background: selectedRoute.brand.accentColor }}
            />
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-0.5">
              <Bus className="h-3 w-3" style={{ color: selectedRoute.brand.accentColor }} />
              {selectedRoute.brand.name}
            </div>
            <div className="font-bold text-sm flex items-center gap-1 flex-wrap mb-2">
              <span className="truncate">{selectedRoute.from.name}</span>
              <ArrowRight className="h-3 w-3 text-blue-600 shrink-0" />
              <span className="truncate">{selectedRoute.to.name}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 mb-2 text-center">
              <div className="rounded bg-slate-50 px-1 py-1">
                <div className="text-[9px] text-slate-500 mt-0.5">Chuyến/ngày</div>
                <div className="text-[10px] font-semibold">{selectedRoute.scheduleCount}</div>
              </div>
              <div className="rounded bg-slate-50 px-1 py-1">
                {selectedRoute.minPrice > 0 ? (
                  <>
                    <div className="text-[9px] text-slate-500 mt-0.5">Giá từ</div>
                    <div className="text-[10px] font-semibold text-blue-700">{formatVND(selectedRoute.minPrice)}</div>
                  </>
                ) : (
                  <>
                    <div className="text-[9px] text-slate-500 mt-0.5">Giá</div>
                    <div className="text-[10px] font-semibold">—</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </Popup>
      )}
    </MapContainer>
  )
}

/** Fit the map to bounds once on mount (no re-fit on every render). */
function FitBounds({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(bounds, { padding: [30, 30] })
  }, [bounds, map])
  return null
}

/** Fix leaflet's tile rendering when the container mounts inside a
 *  dynamically-loaded wrapper — leaflet measures the container size at
 *  init time, which can be stale if the wrapper just swapped in. We keep
 *  calling invalidateSize until the container reports a stable size. */
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
