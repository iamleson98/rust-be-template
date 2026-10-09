import type { ReactNode } from 'react'
import { Bus, Clock, Sparkles, Star, Users, Wallet } from 'lucide-react'
import type { TripResult } from '@/api'
import { Badge } from '@/components/ui/badge'
import { formatTimeVN, formatVND } from '@/lib/format'
import { tSync } from '@/lib/i18n'
import { VEHICLE_TYPE_LABELS } from '@/lib/labels'

export type CompareRow = {
  labelKey: string
  icon: ReactNode
  render: (trip: TripResult) => ReactNode
  /** Lower is better; the best trip of the row gets a tick. */
  score?: (trip: TripResult) => number
}

const icon = (Icon: typeof Clock) => <Icon className="h-3.5 w-3.5" />

const timeCell = (at: string | null | undefined, place: string) => (
  <div className="text-center">
    <div className="font-mono text-base font-bold">{formatTimeVN(at ?? '')}</div>
    <div className="text-[10px] text-muted-foreground">{place}</div>
  </div>
)

export const COMPARE_ROWS: CompareRow[] = [
  {
    labelKey: 'searchPage.departureTime',
    icon: icon(Clock),
    render: (t) => timeCell(t.departureAt, t.fromName),
    score: (t) => new Date(t.departureAt ?? '').getTime(),
  },
  {
    labelKey: 'searchPage.arrivalTime',
    icon: icon(Bus),
    render: (t) => timeCell(t.arrivalAt, t.toName),
  },
  {
    labelKey: 'searchPage.vehicleType',
    icon: icon(Bus),
    render: (t) => (
      <Badge variant="outline" className="font-normal">
        {tSync(VEHICLE_TYPE_LABELS[t.vehicleType] ?? t.vehicleType)}
      </Badge>
    ),
  },
  {
    labelKey: 'searchPage.availableSeats',
    icon: icon(Users),
    render: (t) => (
      <span className={t.availableSeats <= 3 ? 'font-semibold text-rose-600' : 'font-medium'}>
        {t.availableSeats}/{t.totalSeats}
      </span>
    ),
    score: (t) => -t.availableSeats,
  },
  {
    labelKey: 'searchPage.rating',
    icon: icon(Star),
    render: (t) => (
      <span className="inline-flex items-center gap-1">
        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
        <span className="font-medium">{t.brandRating.toFixed(1)}</span>
      </span>
    ),
    score: (t) => -t.brandRating,
  },
  {
    labelKey: 'common.fromPrice',
    icon: icon(Wallet),
    render: (t) => (
      <span className="text-lg font-extrabold text-blue-700">{formatVND(t.minPrice)}</span>
    ),
    score: (t) => t.minPrice,
  },
  {
    labelKey: 'searchPage.comforts',
    icon: icon(Sparkles),
    render: (t) => (
      <div className="flex flex-wrap justify-center gap-1">
        {t.amenities.slice(0, 4).map((a) => (
          <Badge key={a} variant="outline" className="px-1 py-0 text-[10px] font-normal">
            {a}
          </Badge>
        ))}
      </div>
    ),
  },
]

/** Trip id with the best score of `row` (first wins ties); null for unscored rows. */
export function bestTripId(row: CompareRow, trips: TripResult[]): string | null {
  if (!row.score || trips.length === 0) return null
  const score = row.score
  return trips.reduce((best, t) => (score(t) < score(best) ? t : best)).tripId
}
