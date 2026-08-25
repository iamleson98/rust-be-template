'use client'

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Navigation,
  MapPin,
  LocateFixed,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Route as RouteIcon,
  Clock,
  Ruler,
  Navigation2,
} from 'lucide-react'
import { formatDuration } from '@/lib/types'

// ── Leaflet is loaded client-side only (it touches `window`).
//    We render a spinner via <Suspense> until the lazy import resolves.
const DirectionsMap = lazy(() => import('@/components/map/route-navigation-map'))
const DirectionsMapFallback = (
  <div className="flex items-center justify-center h-[50vh] text-muted-foreground">
    <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
  </div>
)

type RouteResponse = {
  coordinates: [number, number][] // [lat, lon] pairs
  distanceKm: number
  durationMin: number
  fallback: boolean
  note?: string
}

export type RouteNavigationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Display name of the boarding point (shown in the dialog header + popup). */
  pickupName?: string | null
  /** Address line (shown under the name if present). */
  pickupAddress?: string | null
  pickupLat: number
  pickupLon: number
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

/**
 * RouteNavigationDialog
 *
 * Opens a fullscreen-ish modal with a Leaflet map showing:
 *  - the user's current location (blue dot)
 *  - the driving-route polyline from there to the pickup point (blue line)
 *  - the pickup point marker (with the pickup name in a popup)
 *
 * Also surfaces the route distance + ETA, an "Open in Google Maps" button
 * (the most reliable cross-platform deep link), and graceful fallbacks
 * for geolocation denial and OSRM failure.
 */
export function RouteNavigationDialog({
  open,
  onOpenChange,
  pickupName,
  pickupAddress,
  pickupLat,
  pickupLon,
}: RouteNavigationDialogProps) {
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

  const hasRoute = route.status === 'ok' && route.data.coordinates.length >= 2
  const showFallbackNotice = route.status === 'ok' && route.data.fallback === true

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] p-0 overflow-hidden gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b bg-linear-to-br from-blue-50/60 to-white">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="h-8 w-8 rounded-lg bg-blue-600 text-white inline-flex items-center justify-center shrink-0">
              <Navigation className="h-4 w-4" />
            </span>
            <span>Đường đi đến điểm đón</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Đường lái xe ngắn nhất từ vị trí hiện tại của bạn đến{' '}
            <span className="font-semibold text-foreground">
              {pickupName ?? 'điểm đón'}
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Pickup info card */}
          <div className="rounded-xl ring-1 ring-black/5 bg-white  p-4 flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-rose-50 text-rose-600 inline-flex items-center justify-center shrink-0">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Điểm đón
              </div>
              <div className="text-sm font-semibold text-foreground truncate">
                {pickupName ?? 'Điểm đón'}
              </div>
              {pickupAddress && (
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {pickupAddress}
                </div>
              )}
              <div className="text-[11px] text-muted-foreground/80 tabular-nums mt-1">
                {pickupLat.toFixed(5)}, {pickupLon.toFixed(5)}
              </div>
            </div>
          </div>

          {/* Geolocation / route status */}
          {geo.status === 'idle' && (
            <StatusBanner
              icon={<Loader2 className="h-4 w-4 animate-spin" />}
              tone="info"
              text="Đang chuẩn bị…"
            />
          )}
          {geo.status === 'loading' && (
            <StatusBanner
              icon={<Loader2 className="h-4 w-4 animate-spin" />}
              tone="info"
              text="Đang xác định vị trí của bạn…"
            />
          )}
          {geo.status === 'denied' && (
            <div className="rounded-xl ring-1 ring-amber-200 bg-amber-50 p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <div className="font-semibold mb-0.5">Không lấy được vị trí</div>
                  <div className="text-xs text-amber-800">{geo.message}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-7">
                <Button size="sm" variant="outline" onClick={requestLocation}>
                  <LocateFixed className="h-3.5 w-3.5" /> Thử lại
                </Button>
                <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" /> Mở trong Google Maps
                  </Button>
                </a>
              </div>
            </div>
          )}

          {geo.status === 'ok' && route.status === 'loading' && (
            <StatusBanner
              icon={<Loader2 className="h-4 w-4 animate-spin" />}
              tone="info"
              text="Đang tính toán đường đi…"
            />
          )}
          {geo.status === 'ok' && route.status === 'error' && (
            <div className="rounded-xl ring-1 ring-rose-200 bg-rose-50 p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-sm text-rose-900">
                  <div className="font-semibold mb-0.5">Không tính được đường đi</div>
                  <div className="text-xs text-rose-800">{route.message}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-7">
                <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" /> Mở trong Google Maps
                  </Button>
                </a>
              </div>
            </div>
          )}

          {showFallbackNotice && (
            <StatusBanner
              icon={<AlertTriangle className="h-4 w-4" />}
              tone="warn"
              text={route.status === 'ok' ? route.data.note ?? 'Dùng khoảng cách chim bay' : ''}
            />
          )}

          {/* Route summary stats */}
          {route.status === 'ok' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <StatTile
                icon={<Ruler className="h-4 w-4" />}
                label="Khoảng cách"
                value={`${route.data.distanceKm} km`}
                tone="blue"
              />
              <StatTile
                icon={<Clock className="h-4 w-4" />}
                label="Thời gian ước tính"
                value={formatDuration(route.data.durationMin)}
                tone="amber"
              />
              <StatTile
                icon={<Navigation2 className="h-4 w-4" />}
                label="Chế độ"
                value={route.data.fallback ? 'Chim bay' : 'Lái xe'}
                tone={route.data.fallback ? 'slate' : 'emerald'}
              />
            </div>
          )}

          {/* The map */}
          {geo.status === 'ok' && (
            <div className="rounded-xl overflow-hidden ring-1 ring-black/5 bg-slate-100 h-[50vh] min-h-75 relative">
              {hasRoute ? (
                <Suspense fallback={DirectionsMapFallback}>
                  <DirectionsMap
                    userLat={geo.lat}
                    userLon={geo.lon}
                    pickupLat={pickupLat}
                    pickupLon={pickupLon}
                    coordinates={route.status === 'ok' ? route.data.coordinates : []}
                    pickupName={pickupName ?? 'Điểm đón'}
                  />
                </Suspense>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                  <Loader2 className="h-5 w-5 animate-spin mr-2 text-blue-600" />
                  Đang tải bản đồ…
                </div>
              )}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-50">
              <Button className="w-full gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                <ExternalLink className="h-4 w-4" />
                Mở trong Google Maps
              </Button>
            </a>
            {geo.status === 'ok' && (
              <Button variant="outline" onClick={requestLocation} className="gap-1.5">
                <LocateFixed className="h-4 w-4" /> Định vị lại
              </Button>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <RouteIcon className="inline h-3 w-3 mr-1 -mt-0.5" />
            Đường đi được tính bằng OSRM (Open Source Routing Machine) trên
            dữ liệu OpenStreetMap. Khoảng cách + thời gian chỉ mang tính
            tham khảo; hãy ưu tiên nút "Mở trong Google Maps" khi cần dữ
            liệu giao thông thời gian thực.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Small presentational helpers ─────────────────────────────

function StatusBanner({
  icon,
  text,
  tone,
}: {
  icon: React.ReactNode
  text: string
  tone: 'info' | 'warn' | 'error'
}) {
  const toneCls =
    tone === 'warn'
      ? 'ring-amber-200 bg-amber-50 text-amber-900'
      : tone === 'error'
        ? 'ring-rose-200 bg-rose-50 text-rose-900'
        : 'ring-blue-200 bg-blue-50 text-blue-900'
  return (
    <div className={`rounded-xl ring-1 ${toneCls} p-3 flex items-center gap-2.5 text-sm`}>
      {icon}
      <span>{text}</span>
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'blue' | 'amber' | 'emerald' | 'slate'
}) {
  const toneCls =
    tone === 'blue'
      ? 'bg-blue-50 text-blue-700'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700'
        : tone === 'emerald'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-slate-100 text-slate-700'
  return (
    <div className="rounded-lg ring-1 ring-black/5 bg-white p-3">
      <div className={`h-7 w-7 rounded-md ${toneCls} inline-flex items-center justify-center mb-1.5`}>
        {icon}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-bold text-foreground tabular-nums">{value}</div>
    </div>
  )
}

// Re-export so callers can use a single import line.
export { Badge }
