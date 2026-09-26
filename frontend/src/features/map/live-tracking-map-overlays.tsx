'use client'

// Extracted from the original 'live-tracking.tsx'.

import { Separator } from '@/components/ui/separator'
import { Gauge, Timer, Navigation, MapPin } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { formatCountdown } from './live-tracking-helpers'
import type { TrackingStatus } from './live-tracking-types'

export function LiveTrackingMapOverlays({
  status,
  speed,
  etaSeconds,
  lastUpdatedText,
  currentLocationName,
}: {
  status: TrackingStatus
  speed: number
  etaSeconds: number
  lastUpdatedText: string
  currentLocationName: string
}) {
  const t = useT()
  return (
    <>
      {/* Overlay: speed + ETA (top-left) */}
      <div className="absolute top-3 left-3 rounded-lg bg-white/90 backdrop-blur px-3 py-2 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Gauge className="h-4 w-4 text-blue-600" />
          <div>
            <div className="text-[10px] text-muted-foreground leading-none">{t('liveTracking.speed')}</div>
            <div className="font-bold text-sm leading-tight">
              {status === 'running' || status === 'arriving_soon'
                ? speed
                : status === 'stopped'
                  ? '0'
                  : status === 'arrived'
                    ? '0'
                    : '—'}
              <span className="text-[10px] font-normal text-muted-foreground ml-0.5">
                km/h
              </span>
            </div>
          </div>
        </div>
        <Separator orientation="vertical" className="h-7" />
        <div className="flex items-center gap-1.5">
          <Timer className="h-4 w-4 text-amber-600" />
          <div>
            <div className="text-[10px] text-muted-foreground leading-none">
              {status === 'arrived'
                ? t('liveTracking.arrived')
                : status === 'not_departed'
                  ? t('liveTracking.departsIn')
                  : t('liveTracking.remaining')}
            </div>
            <div className="font-bold text-sm font-mono leading-tight">
              {status === 'arrived' ? '✓' : formatCountdown(etaSeconds)}
            </div>
          </div>
        </div>
      </div>

      {/* Overlay: last updated (bottom-right) */}
      <div className="absolute bottom-3 right-3 rounded-lg bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
        <Navigation className="h-3 w-3 text-blue-600" />
        <span>{t('liveTracking.updated', { time: lastUpdatedText })}</span>
      </div>

      {/* Overlay: current location (bottom-left) */}
      {status !== 'arrived' && (
        <div className="absolute bottom-3 left-3 rounded-lg bg-white/90 backdrop-blur px-3 py-1.5 text-xs max-w-[60%]">
          <div className="text-[10px] text-muted-foreground leading-none mb-0.5">
            {t('liveTracking.currentLocation')}
          </div>
          <div className="font-medium text-slate-800 truncate flex items-center gap-1">
            <MapPin className="h-3 w-3 text-blue-600 shrink-0" />
            {currentLocationName}
          </div>
        </div>
      )}
    </>
  )
}
