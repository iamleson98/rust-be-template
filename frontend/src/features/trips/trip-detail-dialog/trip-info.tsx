import { ArrowRight, CalendarDays, Clock, Share2, Star } from 'lucide-react'
import type { TripDetail } from '@/api'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { formatDateVN, formatTimeVN } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { amenityIcon } from './amenity-icons'

/** The dialog header: the journey first, then the operator, bus and amenities; share on the side. */
export function TripInfo({ detail, onShare }: { detail: TripDetail; onShare: () => void }) {
  const t = useT()
  const brandName = detail.brand.name ?? ''
  const vehicle = detail.busLayout.vehicleTypeLabel
  const layout = detail.busLayout.name
  // "Giường nằm · Giường nằm 40" says it twice: the layout name only when it adds something.
  const bus = layout && !layout.includes(vehicle) ? `${vehicle} · ${layout}` : (layout ?? vehicle)
  const fewSeats = detail.trip.availableSeats > 0 && detail.trip.availableSeats <= 5

  // pr-14 keeps the dialog's close button clear of the share button.
  return (
    <div className="shrink-0 border-b border-slate-200/80 bg-white px-4 pt-4 pb-3 pr-14 sm:px-6 sm:pr-16">
      <div className="flex items-start gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white"
          style={{ background: detail.brand.accentColor ?? undefined }}
        >
          {brandName
            .split(' ')
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <DialogTitle className="flex flex-wrap items-center gap-x-2 text-lg leading-snug font-bold tracking-tight text-slate-900 sm:text-xl">
            {detail.from.name}
            <ArrowRight className="size-4 shrink-0 text-slate-400" aria-hidden />
            {detail.to.name}
          </DialogTitle>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
            <span className="truncate font-medium text-slate-700">{brandName}</span>
            {detail.brand.rating != null && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-slate-700">
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                {detail.brand.rating.toFixed(1)}
              </span>
            )}
            <span aria-hidden>·</span>
            <span className="truncate">{bus}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onShare}
          aria-label={t('trips.share')}
          title={t('trips.share')}
          className="grid size-9 shrink-0 place-items-center rounded-full text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-primary"
        >
          <Share2 className="size-4" />
        </button>
      </div>

      <DialogDescription className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">
          <CalendarDays className="size-3.5" />
          {formatDateVN(detail.trip.departureAt, {
            weekday: 'long',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
          <Clock className="size-3.5" />
          {t('booking.departure')} {formatTimeVN(detail.trip.departureAt)}
        </span>
        {fewSeats && (
          <span className="rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-600">
            {t('tripDetail.fewSeatsLeft', { count: detail.trip.availableSeats })}
          </span>
        )}
        {detail.amenities.map((a) => (
          <span
            key={a.key}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"
          >
            {amenityIcon[a.key]}
            {a.label}
          </span>
        ))}
      </DialogDescription>
    </div>
  )
}
