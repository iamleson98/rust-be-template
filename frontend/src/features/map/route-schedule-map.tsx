'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Polyline, Popup, useMap, ZoomControl } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Navigation } from 'lucide-react'
import type { TripPickupPoint } from '@/api'
import { useT } from '@/lib/i18n'
import { BasemapLayer } from '@/features/map/basemap-layer'

export type RouteScheduleStop = Pick<
  TripPickupPoint,
  'id' | 'name' | 'stopOrder' | 'lat' | 'lon' | 'kind'
>

type Props = {
  /** Route polyline [lat, lon][] — straight-line fallback is supplied
   *  by the caller when the backend has no geometry. */
  geometry: [number, number][] | null | undefined
  pickupPoints: RouteScheduleStop[]
  fromName: string
  toName: string
  accentColor?: string
}

/** Numbered circular marker: order badge on a colored disc. */
function stopIcon(index: number, total: number, accent: string): L.DivIcon {
  const isFirst = index === 0
  const isLast = index === total - 1
  const bg = isFirst ? '#2563eb' : isLast ? '#dc2626' : accent
  const ring = isFirst ? '#1e40af' : isLast ? '#991b1b' : 'white'
  const label = isFirst ? 'A' : isLast ? 'B' : String(index)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">` +
    `<circle cx="15" cy="15" r="13" fill="${bg}" stroke="${ring}" stroke-width="2.5"/>` +
    (isFirst || isLast
      ? `<circle cx="15" cy="15" r="13" fill="none" stroke="${bg}" stroke-width="1.5" opacity="0.4"/>`
      : '') +
    `<text x="15" y="15" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="white">${label}</text>` +
    `</svg>`
  return L.divIcon({
    html: svg,
    className: 'vexevn-stop-pin',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
  })
}

/** Fit the view to all points + geometry once the map is ready. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  const bounds = useMemo(
    () => (points.length > 0 ? L.latLngBounds(points.map((p) => L.latLng(p[0], p[1]))) : null),
    [points],
  )
  useEffect(() => {
    if (!bounds) return
    // setTimeout 0: run after Leaflet's initial layout pass inside the
    // animating dialog (FixSize has settled the container by then).
    const id = setTimeout(() => {
      map.invalidateSize({ animate: false, pan: false })
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
    }, 0)
    return () => clearTimeout(id)
  }, [map, bounds])
  return null
}

/** Reuse the dialog-safe size fix: keeps calling invalidateSize until the
 *  container (mounted inside an animating dialog) reports a stable size.
 *  (Same approach as leaflet-map.tsx's FixSize — inlined here to keep this
 *  module self-contained.) */
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
        if (stable === 1) map.invalidateSize()
        if (stable > 8) clearInterval(timer)
      } else {
        stable = 0
        map.invalidateSize()
      }
      lastW = w
      lastH = h
    }
    const timer = setInterval(tick, 100)
    tick()
    return () => clearInterval(timer)
  }, [map])
  return null
}

export function RouteScheduleMap({
  geometry,
  pickupPoints,
  fromName,
  toName,
  accentColor = '#2563eb',
}: Props) {
  const t = useT()

  const geo = useMemo(() => geometry ?? [], [geometry])
  const stops = useMemo(
    () =>
      pickupPoints
        .filter((p) => p.lat != null && p.lon != null)
        .slice()
        .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
        .map((p) => ({ ...p, lat: p.lat as number, lon: p.lon as number })),
    [pickupPoints],
  )

  // Everything the view must show: geometry + stop coordinates.
  const allPoints = useMemo<[number, number][]>(
    () => [...geo, ...stops.map((s) => [s.lat, s.lon] as [number, number])],
    [geo, stops],
  )

  if (allPoints.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">{t('mapNav.noRouteData')}</div>
  }

  const center: [number, number] = allPoints[0]

  return (
    <div>
      <div className="rounded-xl overflow-hidden border relative">
        <MapContainer
          center={center}
          zoom={8}
          scrollWheelZoom={false}
          zoomControl={false}
          className="h-75 md:h-95 w-full"
          style={{ background: '#e2eaf2' }}
        >
          <BasemapLayer switcher={false} />
          <ZoomControl position="bottomright" />
          <FixSize />
          <FitBounds points={allPoints} />

          {geo.length >= 2 && (
            <Polyline
              positions={geo}
              pathOptions={{ color: accentColor, weight: 4, opacity: 0.85 }}
            />
          )}
          {geo.length < 2 && stops.length >= 2 && (
            // Straight-line fallback when the route has no geometry —
            // still an honest visual (dashed = "no real road data").
            <Polyline
              positions={stops.map((s) => [s.lat, s.lon] as [number, number])}
              pathOptions={{ color: accentColor, weight: 3, opacity: 0.7, dashArray: '8 8' }}
            />
          )}

          {stops.map((s, i) => (
            <Marker
              key={s.id}
              position={[s.lat, s.lon]}
              icon={stopIcon(i, stops.length, accentColor)}
            >
              <Popup>
                <div className="text-sm min-w-40">
                  <div className="font-semibold">{s.name ?? '—'}</div>
                  <div className="text-xs text-slate-500 capitalize">
                    {(s.kind ?? '').replace(/_/g, ' ')}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Overlay legend */}
        <div className="absolute top-3 left-3 rounded-lg bg-white/90 backdrop-blur px-3 py-1.5 text-xs font-medium flex items-center gap-2 pointer-events-none">
          <Navigation className="h-3.5 w-3.5 text-blue-600" />
          {fromName} → {toName}
        </div>
        <div className="absolute bottom-3 left-3 rounded-lg bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-muted-foreground pointer-events-none">
          {t('mapNav.stopsCount', { count: stops.length })}
        </div>
      </div>

      {/* Legend under the map — explains the numbered pins. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600 ring-2 ring-blue-300" />
          {t('mapNav.firstStop')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400 ring-2 ring-white" />
          {t('mapNav.middleStop')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-600 ring-2 ring-rose-300" />
          {t('mapNav.lastStop')}
        </span>
      </div>
    </div>
  )
}
