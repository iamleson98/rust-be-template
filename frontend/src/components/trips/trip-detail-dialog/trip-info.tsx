'use client'

/**
 * TripInfo — header card of the TripDetailDialog showing brand
 * identity, route summary, departure time/duration/distance, and
 * the "share" CTA.
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 257-352). Pure refactor.
 */

import {
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Star,
  Navigation,
  Calendar,
  Clock,
  AlertTriangle,
  Share2,
} from 'lucide-react'
import {
  formatTimeVN,
  formatDateVN,
} from '@/lib/types'
import type { TripDetailDialogData as TripDetail } from './types'
import { amenityIcon } from './amenity-icons'

export function TripInfo({
  detail,
  onShare,
}: {
  detail: TripDetail
  onShare: () => void
}) {
  return (
    <div className="px-5 py-4 border-b bg-linear-to-r from-slate-50 to-white shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className="h-9 w-9 rounded-lg flex items-center justify-center text-white font-extrabold text-xs shrink-0"
              style={{ background: detail.brand.accentColor }}
            >
              {detail.brand.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="font-bold truncate">{detail.brand.name}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-0.5 text-amber-500">
                  <Star className="h-3 w-3 fill-current" />
                  {detail.brand.rating.toFixed(1)}
                </span>
                <span>•</span>
                <span>{detail.busLayout.vehicleTypeLabel}</span>
                <span>•</span>
                <span>{detail.busLayout.name}</span>
              </div>
            </div>
          </div>
          <DialogTitle className="text-base font-bold flex items-center gap-2 flex-wrap">
            {detail.from.name}
            <Navigation className="h-3.5 w-3.5 text-blue-700" />
            {detail.to.name}
          </DialogTitle>
          <DialogDescription className="text-xs mt-1.5 flex items-center gap-2 flex-wrap">
            {/* Prominent departure date with calendar icon */}
            <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 text-blue-800 px-2 py-0.5 font-semibold">
              <Calendar className="h-3.5 w-3.5" />
              {formatDateVN(detail.trip.departureAt, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Khởi hành {formatTimeVN(detail.trip.departureAt)}
            </span>
          </DialogDescription>
        </div>
        {detail.trip.availableSeats <= 5 && (
          <Badge className="bg-rose-100 text-rose-700 border-0 shrink-0">
            <AlertTriangle className="h-3 w-3 mr-0.5" />
            Chỉ còn {detail.trip.availableSeats} chỗ
          </Badge>
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
          onClick={onShare}
        >
          <Share2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Chia sẻ</span>
        </Button>
      </div>

      {/* Amenities */}
      {detail.amenities.length > 0 && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {detail.amenities.map((a) => (
            <span
              key={a.key}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
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
