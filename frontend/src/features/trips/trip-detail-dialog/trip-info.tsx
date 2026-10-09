'use client'

import { DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { AlertTriangle, ArrowRight, Calendar, Clock, Share2, Star } from 'lucide-react'
import { formatTimeVN, formatDateVN } from '@/lib/format'
import type { TripDetail } from '@/api'
import { amenityIcon } from './amenity-icons'

/** The dialog header: operator, route, departure and amenities, with a share button. */
export function TripInfo({ detail, onShare }: { detail: TripDetail; onShare: () => void }) {
  const t = useT()
  const brandName = detail.brand.name ?? ''
  const vehicle = detail.busLayout.vehicleTypeLabel
  const layout = detail.busLayout.name
  // "Giường nằm · Giường nằm 40" says it twice: the layout name only when it adds something.
  const bus = layout && !layout.includes(vehicle) ? `${vehicle} · ${layout}` : (layout ?? vehicle)
  // pr-16 keeps the dialog's close button clear of the share button.
  return (
    <div className="shrink-0 border-b bg-background px-5 py-4 pr-16">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className="h-9 w-9 rounded-lg flex items-center justify-center text-white font-extrabold text-xs shrink-0"
              style={{ background: detail.brand.accentColor ?? undefined }}
            >
              {brandName
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="font-bold truncate">{brandName}</div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {detail.brand.rating != null && (
                  <>
                    <span className="flex shrink-0 items-center gap-0.5 text-amber-500">
                      <Star className="h-3 w-3 fill-current" />
                      {detail.brand.rating.toFixed(1)}
                    </span>
                    <span aria-hidden>•</span>
                  </>
                )}
                <span className="truncate">{bus}</span>
              </div>
            </div>
          </div>
          <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base leading-snug font-bold">
            {detail.from.name}
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {detail.to.name}
          </DialogTitle>
          <DialogDescription className="text-xs mt-1.5 flex items-center gap-2 flex-wrap">
            {/* Prominent departure date with calendar icon */}
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 font-semibold text-primary">
              <Calendar className="h-3.5 w-3.5" />
              {formatDateVN(detail.trip.departureAt, {
                weekday: 'long',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {t('booking.departure')} {formatTimeVN(detail.trip.departureAt)}
            </span>
          </DialogDescription>
        </div>
        {detail.trip.availableSeats <= 5 && (
          <Badge className="bg-rose-100 text-rose-700 border-0 shrink-0">
            <AlertTriangle className="h-3 w-3 mr-0.5" />
            {t('tripDetail.fewSeatsLeft', { count: detail.trip.availableSeats })}
          </Badge>
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onShare}
          aria-label={t('trips.share')}
        >
          <Share2 />
          <span className="hidden sm:inline">{t('trips.share')}</span>
        </Button>
      </div>

      {/* Amenities */}
      {detail.amenities.length > 0 && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {detail.amenities.map((a) => (
            <span
              key={a.key}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {amenityIcon[a.key]}
              {a.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
