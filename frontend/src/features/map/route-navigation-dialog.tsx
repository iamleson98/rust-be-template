'use client'

import { lazy, Suspense } from 'react'
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
import { useRouteNavigation } from './route-navigation-state'
import { StatusBanner, StatTile } from './route-navigation-dialog-parts'

// ── Leaflet is loaded client-side only (it touches `window`).
//    We render a spinner via <Suspense> until the lazy import resolves.
const DirectionsMap = lazy(() => import('@/features/map/route-navigation-map'))
const DirectionsMapFallback = (
  <div className="flex items-center justify-center h-[50vh] text-muted-foreground">
    <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
  </div>
)

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
  const { geo, route, requestLocation, googleMapsUrl } = useRouteNavigation(
    open,
    pickupLat,
    pickupLon
  )

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

// Re-export so callers can use a single import line.
export { Badge }
