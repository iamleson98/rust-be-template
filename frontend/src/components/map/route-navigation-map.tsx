'use client'

// Route-navigation Leaflet map.
//
// Rendered inside a Dialog by `route-navigation-dialog.tsx`. Plots:
//   - the user's current location as a blue dot
//   - the OSRM driving-route polyline as a blue line
//   - the pickup point as a red pin with a popup containing the name
//
// We do NOT dynamically import this file ourselves — the parent does
// that with `dynamic(() => import('@/components/map/route-navigation-map'), { ssr:false })`.
// But just in case someone imports it directly, we mark 'use client' so
// Next.js doesn't try to render it on the server.

import { useEffect, useMemo } from 'react'
import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  Tooltip as LeafletTooltip,
  useMap,
  ZoomControl,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { OpenFreeMapLayer } from '@/components/map/openfreemap-layer'

// Fix leaflet's default marker icon paths (broken under bundlers).
// We use custom divIcons below, but this is a safety net.
delete (L.Icon.Default.prototype as { _getIconUrl?: () => string })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

/** Build a coloured pin divIcon (no external image assets needed). */
function pinIcon(color: string): L.DivIcon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3" fill="white" stroke="none"/></svg>`
  return L.divIcon({
    html: svg,
    className: 'vexevn-nav-pin',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  })
}

const RED_PIN = pinIcon('#dc2626')

type RouteNavigationMapProps = {
  userLat: number
  userLon: number
  pickupLat: number
  pickupLon: number
  coordinates: [number, number][] // [lat, lon] pairs (Leaflet order)
  pickupName: string
}

/**
 * Fit the map bounds to enclose both endpoints AND the route polyline.
 * Recomputes whenever the coordinates change.
 */
function FitBounds({
  userLat,
  userLon,
  pickupLat,
  pickupLon,
  coordinates,
}: {
  userLat: number
  userLon: number
  pickupLat: number
  pickupLon: number
  coordinates: [number, number][]
}) {
  const map = useMap()
  useEffect(() => {
    const pts: L.LatLngExpression[] = [
      [userLat, userLon],
      [pickupLat, pickupLon],
      ...coordinates,
    ]
    const bounds = L.latLngBounds(pts)
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
  }, [map, userLat, userLon, pickupLat, pickupLon, coordinates])
  return null
}

/**
 * Fix leaflet's tile rendering when the container mounts inside a
 * Dialog (the size is 0 when first measured, then snaps). Mirrors the
 * approach in route-map-inner.tsx.
 */
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
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => {
      clearInterval(timer)
      ro.disconnect()
    }
  }, [map])
  return null
}

export default function RouteNavigationMap({
  userLat,
  userLon,
  pickupLat,
  pickupLon,
  coordinates,
  pickupName,
}: RouteNavigationMapProps) {
  // Center on the user's location initially. FitBounds will zoom to fit
  // both endpoints once the polyline arrives.
  const initialCenter = useMemo<[number, number]>(() => [userLat, userLon], [userLat, userLon])

  return (
    <MapContainer
      center={initialCenter}
      zoom={13}
      scrollWheelZoom
      zoomControl={false}
      className="h-full w-full"
      style={{ background: '#aadaff' }}
    >
      <OpenFreeMapLayer />
      <ZoomControl position="bottomright" />
      <FixSize />
      <FitBounds
        userLat={userLat}
        userLon={userLon}
        pickupLat={pickupLat}
        pickupLon={pickupLon}
        coordinates={coordinates}
      />

      {/* Driving-route polyline (blue line) */}
      {coordinates.length >= 2 && (
        <>
          {/* Wide invisible hit area for easier touch interaction */}
          <Polyline
            positions={coordinates}
            pathOptions={{ color: 'transparent', weight: 12 }}
          />
          {/* Visible line — solid blue, rounded caps */}
          <Polyline
            positions={coordinates}
            pathOptions={{
              color: '#2563eb',
              weight: 5,
              opacity: 0.9,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </>
      )}

      {/* User's current location — blue dot */}
      <CircleMarker
        center={[userLat, userLon]}
        radius={9}
        pathOptions={{
          color: '#2563eb',
          weight: 3,
          fillColor: '#3b82f6',
          fillOpacity: 0.9,
        }}
      >
        <LeafletTooltip direction="top" offset={[0, -9]} opacity={1}>
          <span className="text-xs font-semibold text-slate-800">Vị trí của bạn</span>
        </LeafletTooltip>
      </CircleMarker>

      {/* Pickup point — red pin with name popup */}
      <Marker position={[pickupLat, pickupLon]} icon={RED_PIN}>
        <Popup>
          <div className="min-w-45">
            <div className="text-[11px] font-bold uppercase tracking-wide text-rose-600 mb-0.5">
              Điểm đón
            </div>
            <div className="font-bold text-sm text-slate-900">{pickupName}</div>
            <div className="text-[11px] text-slate-500 tabular-nums mt-1">
              {pickupLat.toFixed(5)}, {pickupLon.toFixed(5)}
            </div>
          </div>
        </Popup>
      </Marker>
    </MapContainer>
  )
}
