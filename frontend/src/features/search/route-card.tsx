import { Star } from 'lucide-react'
import type { RouteOut } from '@/api'
import { formatCurrency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { usePrefs } from '@/stores/prefs'

/**
 * One route: operator (and rating), the two ends, trips a day and the
 * cheapest fare. Every number is the API's; no fare shows while the
 * route has no schedules.
 */
export function RouteCard({
  route: r,
  onSelect,
  onHover,
}: {
  route: RouteOut
  onSelect: () => void
  /** Warm the search cache before the tap. */
  onHover?: () => void
}) {
  const t = useT()
  const currency = usePrefs((s) => s.currency)
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onHover}
      className="group flex w-full flex-col rounded-2xl bg-white p-4 text-left shadow-soft ring-1 ring-slate-200/80 transition duration-200 hover:-translate-y-0.5 hover:shadow-float hover:ring-primary/30"
    >
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {r.brand.logoUrl ? (
          <img
            src={r.brand.logoUrl}
            alt=""
            className="size-4 shrink-0 rounded object-contain"
            loading="lazy"
          />
        ) : (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: r.brand.accentColor ?? '#64748b' }}
          />
        )}
        <span className="truncate">{r.brand.name}</span>
        {r.brand.rating != null && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 font-medium text-slate-700">
            <Star className="size-3 fill-amber-400 text-amber-400" />
            {r.brand.rating.toFixed(1)}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3">
        <div className="flex flex-col items-center py-1.5">
          <span className="size-2 rounded-full border-2 border-primary" />
          <span className="my-1 w-px flex-1 border-l border-dashed border-slate-300" />
          <span className="size-2 rounded-full bg-rose-500" />
        </div>
        <div className="min-w-0 space-y-2.5">
          <div className="truncate text-[15px] font-semibold text-slate-900">{r.from.name}</div>
          <div className="truncate text-[15px] font-semibold text-slate-900">{r.to.name}</div>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-500">
          {r.scheduleCount > 0 ? t('home.tripsPerDay', { count: r.scheduleCount }) : ''}
        </span>
        {r.priceFrom != null ? (
          <span className="text-right leading-tight">
            <span className="block text-[11px] text-slate-500">{t('home.priceFrom')}</span>
            <span className="text-base font-bold text-primary tabular-nums">
              {formatCurrency(r.priceFrom, currency)}
            </span>
          </span>
        ) : (
          <span className="text-xs text-slate-400">{t('searchPage.noSchedulesYet')}</span>
        )}
      </div>
    </button>
  )
}
