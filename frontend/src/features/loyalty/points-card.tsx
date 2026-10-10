import { Trophy } from 'lucide-react'
import type { LoyaltyResponse } from '@/api'
import { formatNum, formatVndShort, useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/stores/prefs'
import { tierView } from './api'

/**
 * Points, tier, the way to the next tier and the lifetime numbers — all
 * from the backend summary. "Last trip" only shows once there is one.
 */
export function LoyaltyPointsCard({ summary }: { summary: LoyaltyResponse }) {
  const t = useT()
  const money = useMoney()
  const currency = usePrefs((s) => s.currency)
  const { tier, nextTier, style, progress } = tierView(summary)
  const last = summary.history[0]
  const spent =
    currency === 'VND' && summary.totalSpent >= 1_000_000
      ? `${formatVndShort(summary.totalSpent)} ₫`
      : money(summary.totalSpent)
  const stats = [
    { label: t('home.completedTripsCount'), value: formatNum(summary.completedTrips) },
    { label: t('home.totalSpentCount'), value: spent },
    ...(last ? [{ label: t('home.lastTripEarned'), value: `+${formatNum(last.points)}` }] : []),
  ]

  return (
    <section className="rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-200/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">{t('home.currentPoints')}</div>
          <div className="mt-0.5 text-4xl font-bold tracking-tight text-slate-900 tabular-nums">
            {formatNum(summary.points)}
          </div>
        </div>
        {tier && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold [&_svg]:size-4',
              style.bg,
              style.color,
            )}
          >
            {style.icon}
            {tier.name}
          </span>
        )}
      </div>

      {nextTier ? (
        <div className="mt-5">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {t('home.pointsToNext', {
              count: formatNum(Math.max(0, nextTier.minPoints - summary.points)),
              name: nextTier.name,
            })}
          </p>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-1.5 text-sm font-medium text-violet-700">
          <Trophy className="size-4" aria-hidden />
          {t('home.topTierReached')}
        </p>
      )}

      <dl
        className={cn(
          'mt-5 grid divide-x divide-slate-100 border-t border-slate-100 pt-4 text-center',
          stats.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
        )}
      >
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col-reverse px-1">
            <dt className="text-[11px] text-slate-500">{s.label}</dt>
            <dd className="text-lg font-semibold text-slate-900 tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
