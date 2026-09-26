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
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

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
    // Intentional effect-synced state (dialog reset-on-open /
    // server-data snapshot / DOM-availability gate).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGeo({ status: 'idle' })
    setRoute({ status: 'idle' })
  }, [open])

  // ── Step 1: get the user's geolocation ──
  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo({
        status: 'denied',
        message: translate(
          useApp.getState().lang,
          'mapNav.browserNoGeolocation'
        ),
      })
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
            ? translate(
                useApp.getState().lang,
                'mapNav.geoPermissionDenied'
              )
            : err.code === err.POSITION_UNAVAILABLE
              ? translate(useApp.getState().lang, 'mapNav.geoPositionUnavailable')
              : err.code === err.TIMEOUT
                ? translate(useApp.getState().lang, 'mapNav.geoTimeout')
                : translate(useApp.getState().lang, 'mapNav.geoUnknownError')
        setGeo({ status: 'denied', message })
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }, [])

  // Auto-trigger geolocation when the dialog opens.
  useEffect(() => {
    if (open && geo.status === 'idle') {
      // Intentional effect-synced state (dialog reset-on-open /
      // server-data snapshot / DOM-availability gate).
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        const msg =
          e instanceof Error
            ? e.message
            : translate(useApp.getState().lang, 'mapNav.unknownError')
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
