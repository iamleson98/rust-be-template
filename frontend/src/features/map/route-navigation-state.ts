'use client'

/**
 * Geolocation + OSRM route-fetch state machine for the
 * RouteNavigationDialog: resolves the user's position, fetches the
 * driving route to the pickup point, and builds the Google Maps
 * deep link.
 *
 * Extracted from the original 'route-navigation-dialog.tsx'.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type RouteResponse = {
  coordinates: [number, number][] // [lat, lon] pairs
  distanceKm: number
  durationMin: number
  fallback: boolean
  note?: string
}

type GeoState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'denied'; message: string }
  | { status: 'ok'; lat: number; lon: number }

type RouteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: RouteResponse }
  | { status: 'error'; message: string }

export function useRouteNavigation(
  open: boolean,
  pickupLat: number,
  pickupLon: number
) {
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' })
  const [route, setRoute] = useState<RouteState>({ status: 'idle' })

  // Reset state every time the dialog opens, so the user always sees a
  // fresh "locating you…" state instead of stale data from last time.
  useEffect(() => {
    if (!open) return
    setGeo({ status: 'idle' })
    setRoute({ status: 'idle' })
  }, [open])

  // ── Step 1: get the user's geolocation ──
  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo({ status: 'denied', message: 'Trình duyệt không hỗ trợ định vị' })
      return
    }
    setGeo({ status: 'loading' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ status: 'ok', lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Bạn đã từ chối quyền truy cập vị trí. Bật lại trong cài đặt trình duyệt để xem đường đi.'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'Không xác định được vị trí hiện tại.'
              : err.code === err.TIMEOUT
                ? 'Hết giờ xác định vị trí. Thử lại trong khu vực thoáng.'
                : 'Lỗi không xác định khi định vị.'
        setGeo({ status: 'denied', message })
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }, [])

  // Auto-trigger geolocation when the dialog opens.
  useEffect(() => {
    if (open && geo.status === 'idle') {
      requestLocation()
    }
  }, [open, geo.status, requestLocation])

  // ── Step 2: fetch the route polyline once we have a fix ──
  const fetchedFor = useRef<string>('')
  useEffect(() => {
    if (geo.status !== 'ok') return
    const key = `${geo.lat.toFixed(5)},${geo.lon.toFixed(5)}→${pickupLat.toFixed(5)},${pickupLon.toFixed(5)}`
    if (fetchedFor.current === key) return // already fetched for this pair
    fetchedFor.current = key

    let cancelled = false
    const run = async () => {
      setRoute({ status: 'loading' })
      try {
        const url =
          `/api/map/route?fromLat=${geo.lat}&fromLon=${geo.lon}` +
          `&toLat=${pickupLat}&toLon=${pickupLon}&profile=driving`
        const res = await fetch(url)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as RouteResponse
        if (!cancelled) setRoute({ status: 'ok', data })
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Lỗi không xác định'
        setRoute({ status: 'error', message: msg })
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [geo, pickupLat, pickupLon])

  // ── Derived display values ──
  const googleMapsUrl = useMemo(() => {
    if (geo.status !== 'ok') {
      // If we don't have the user's location, just open directions
      // with the destination only — Google Maps will prompt for "from".
      return `https://www.google.com/maps/dir/?api=1&destination=${pickupLat},${pickupLon}`
    }
    return `https://www.google.com/maps/dir/?api=1&origin=${geo.lat},${geo.lon}&destination=${pickupLat},${pickupLon}&travelmode=driving`
  }, [geo, pickupLat, pickupLon])

  return { geo, route, requestLocation, googleMapsUrl }
}
