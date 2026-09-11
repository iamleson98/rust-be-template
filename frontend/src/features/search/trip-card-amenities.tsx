'use client'

/**
 * TripCardAmenities — the amenities + seat-availability parts of the
 * TripCard: the desktop-only right column (icon badges, seats-left note,
 * availability bar) and the mobile variants (icon badges row + slim bar).
 *
 * Extracted from the original `trip-card.tsx`; `maxVisibleAmenities` /
 * `overflowCount` / seat percentages are computed by the parent (they are
 * shared by both variants) while the `amenityIcon` map lives here.
 */

import type { TripResult } from '@/lib/store'
import { AMENITY_LABELS } from '@/lib/types'
import { MapPin, Users, TrendingUp, Wifi, Snowflake, Droplet, Zap } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

const amenityIcon: Record<string, React.ReactNode> = {
  wifi: <Wifi className="h-3.5 w-3.5" />,
  ac: <Snowflake className="h-3.5 w-3.5" />,
  water: <Droplet className="h-3.5 w-3.5" />,
  charging: <Zap className="h-3.5 w-3.5" />,
}

/* Amenities + seats (desktop) */
export function TripCardAmenities({
  trip,
  maxVisibleAmenities,
  overflowCount,
  lowSeats,
  sellingFast,
  availBarColor,
  seatAvailPct,
}: {
  trip: TripResult
  maxVisibleAmenities: number
  overflowCount: number
  lowSeats: boolean
  sellingFast: boolean
  availBarColor: string
  seatAvailPct: number
}) {
  return (
    <div className="hidden lg:flex flex-col items-end gap-1.5 shrink-0">
      <div className="flex items-center gap-1">
        {trip.amenities.slice(0, maxVisibleAmenities).map((a) => (
          <span
            key={a}
            title={AMENITY_LABELS[a] ?? a}
            className="h-6 w-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors"
          >
            {amenityIcon[a] ?? <MapPin className="h-3 w-3" />}
          </span>
        ))}
        {overflowCount > 0 && (
          <span className="h-6 px-1.5 rounded-md bg-slate-100 flex items-center justify-center text-[10px] text-muted-foreground group-hover:bg-blue-50 transition-colors">
            +{overflowCount}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 text-xs">
        <Users className="h-3.5 w-3.5 text-slate-400" />
        {lowSeats ? (
          <span className="text-rose-600 font-semibold flex items-center gap-1">
            {sellingFast && <TrendingUp className="h-3 w-3" />}
            Chỉ còn {trip.availableSeats} chỗ
          </span>
        ) : (
          <span className="text-muted-foreground">{trip.availableSeats} chỗ trống</span>
        )}
      </div>
      {/* Seat availability bar (desktop) — slim, muted */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="w-full max-w-30 h-1 rounded-full bg-slate-200 overflow-hidden cursor-default">
            <div
              className={`h-full rounded-full ${availBarColor} transition-all duration-500`}
              style={{ width: `${seatAvailPct}%` }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {trip.availableSeats}/{trip.totalSeats} ghế trống ({Math.round(seatAvailPct)}%)
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

/* Mobile amenities - icon only badges + Mobile seat availability bar */
export function TripCardAmenitiesMobile({
  trip,
  maxVisibleAmenities,
  overflowCount,
  lowSeats,
  sellingFast,
  availBarColor,
  seatAvailPct,
}: {
  trip: TripResult
  maxVisibleAmenities: number
  overflowCount: number
  lowSeats: boolean
  sellingFast: boolean
  availBarColor: string
  seatAvailPct: number
}) {
  return (
    <>
      <div className="lg:hidden mt-2.5 flex items-center gap-1.5 flex-wrap">
        {trip.amenities.slice(0, maxVisibleAmenities).map((a) => (
          <span
            key={a}
            title={AMENITY_LABELS[a] ?? a}
            className="h-6 w-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors"
          >
            {amenityIcon[a] ?? <MapPin className="h-3 w-3" />}
          </span>
        ))}
        {overflowCount > 0 && (
          <span className="h-6 px-1.5 rounded-md bg-slate-100 flex items-center justify-center text-[10px] text-muted-foreground group-hover:bg-blue-50 transition-colors">
            +{overflowCount}
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
          <Users className="h-3 w-3" />
          {lowSeats ? (
            <span className="text-rose-600 font-semibold flex items-center gap-1">
              {sellingFast && <TrendingUp className="h-3 w-3" />}
              Còn {trip.availableSeats} chỗ
            </span>
          ) : (
            <span>{trip.availableSeats} chỗ trống</span>
          )}
        </span>
      </div>

      <div className="lg:hidden mt-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full h-1 rounded-full bg-slate-200 overflow-hidden cursor-default">
              <div
                className={`h-full rounded-full ${availBarColor} transition-all duration-500`}
                style={{ width: `${seatAvailPct}%` }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {trip.availableSeats}/{trip.totalSeats} ghế trống ({Math.round(seatAvailPct)}%)
          </TooltipContent>
        </Tooltip>
      </div>
    </>
  )
}
