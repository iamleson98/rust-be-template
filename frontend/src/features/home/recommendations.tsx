import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Clock } from 'lucide-react'
import { recommendationsOptions } from '@/api'
import { formatCurrency, formatDateVN } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/stores/prefs'
import { HomeSection, RAIL, RailSkeleton } from './section'

/** The next departures with seats left (`GET /api/recommendations`); each opens the trip. */
export function Recommendations() {
  const currency = usePrefs((s) => s.currency)
  const t = useT()
  const { data, isLoading } = useQuery(recommendationsOptions())
  const items = data?.items ?? []

  if (isLoading) return <RailSkeleton count={4} />
  if (items.length === 0) return null

  return (
    <HomeSection
      title={t('home.recommendationsTitle')}
      subtitle={t('home.recommendationsSubtitle')}
    >
      <div className={cn(RAIL, 'lg:grid-cols-4')}>
        {items.map((rec) => (
          <Link
            key={rec.tripId}
            to="/trips/$tripId"
            params={{ tripId: rec.tripId }}
            className="group flex flex-col rounded-2xl bg-white p-4 shadow-soft ring-1 ring-slate-200/80 transition duration-200 hover:-translate-y-0.5 hover:shadow-float hover:ring-primary/30"
          >
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: rec.brandAccent }}
              />
              <span className="truncate">{rec.brandName}</span>
              <span className="ml-auto shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                {rec.vehicleTypeLabel}
              </span>
            </div>
            <div className="mt-3 truncate text-[15px] font-semibold text-slate-900">
              {rec.fromName} → {rec.toName}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="size-3.5" />
              <span className="font-semibold text-slate-700 tabular-nums">{rec.departureTime}</span>
              <span>
                ·{' '}
                {formatDateVN(rec.departureAt ?? rec.departureDate, {
                  weekday: 'short',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </span>
            </div>
            <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">
                {rec.availableSeats} {t('common.seatsAvailable')}
              </span>
              <span className="text-right leading-tight">
                <span className="block text-[11px] text-slate-500">{t('common.fromPrice')}</span>
                <span className="text-base font-bold text-primary tabular-nums">
                  {formatCurrency(rec.minPrice, currency)}
                </span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </HomeSection>
  )
}
