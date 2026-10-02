'use client'

// Extracted from the original 'loyalty-widget.tsx'.
//
// REAL-DATA REWORK: every value comes from the backend loyalty summary
// (points / tier / next tier / lifetime stats) — nothing is invented
// client-side.

import { useApp } from '@/lib/store'
import { useT } from '@/lib/i18n'
import type { LoyaltySummary, LoyaltyTier } from '@/lib/queries'
import { DEFAULT_TIER_STYLE, TIER_STYLES } from './loyalty-data'

export function LoyaltyPointsCard({ summary }: { summary: LoyaltySummary }) {
  const t = useT()
  const { lang } = useApp()
  const locale = lang === 'en' ? 'en-US' : 'vi-VN'

  const currentTier: LoyaltyTier = summary.tier
  const nextTier = summary.nextTier
  const style = TIER_STYLES[currentTier.key] ?? DEFAULT_TIER_STYLE

  // Progress toward the next tier — both bounds are backend data.
  const progress =
    nextTier != null
      ? Math.min(
          100,
          Math.max(
            0,
            ((summary.points - currentTier.minPoints) /
              Math.max(1, nextTier.minPoints - currentTier.minPoints)) *
              100,
          ),
        )
      : 100

  return (
    <div className="rounded-xl border bg-linear-to-br from-blue-50 to-blue-50 p-4 text-center">
      <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
        {t('home.currentPoints')}
      </div>
      <div className="text-4xl font-extrabold text-blue-700 mt-1">
        {summary.points.toLocaleString(locale)}
      </div>

      {/* Tier badge */}
      <div
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold"
        style={{ borderColor: style.ring, color: style.ring }}
      >
        {style.icon}
        {currentTier.name}
      </div>

      {/* Progress to next tier */}
      {nextTier ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>{currentTier.name}</span>
            <span>
              {nextTier.name} ({nextTier.minPoints.toLocaleString(locale)} {t('home.pointsUnit')})
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-linear-to-r from-blue-500 to-blue-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {t('home.pointsToNext', {
              count: Math.max(0, nextTier.minPoints - summary.points).toLocaleString(locale),
              name: nextTier.name,
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
          {t('home.topTierReached')}
        </div>
      )}

      {/* Real lifetime stats (completed trips + total spent) */}
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-blue-100 pt-3 text-center">
        <div>
          <div className="text-lg font-bold tabular-nums">
            {summary.completedTrips.toLocaleString(locale)}
          </div>
          <div className="text-[10px] text-muted-foreground">{t('home.completedTripsCount')}</div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums">{formatShortVND(summary.totalSpent)}</div>
          <div className="text-[10px] text-muted-foreground">{t('home.totalSpentCount')}</div>
        </div>
      </div>
    </div>
  )
}

/** Compact VND formatter for the lifetime-spend stat. */
function formatShortVND(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} triệu`
  return n.toLocaleString('vi-VN')
}
