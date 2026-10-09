import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, Gift, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { tierView, useLoyalty } from '@/features/loyalty/api'
import { formatNum } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ConsoleCard } from './console-card'

/** Points, tier badge and progress toward the next tier. */
export function LoyaltySnapshotCard() {
  const t = useT()
  const navigate = useNavigate()
  const { data: summary } = useLoyalty()
  const { tier, nextTier, style, progress } = tierView(summary)

  return (
    <ConsoleCard
      bar="from-violet-500 to-fuchsia-500"
      icon={<Gift className="h-4 w-4 text-violet-600" />}
      title={t('nav.loyalty')}
    >
      {!summary || !tier ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-2.5 w-full rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-extrabold tabular-nums text-violet-700">
                {formatNum(summary.points)}
              </div>
              <div className="text-[11px] text-muted-foreground">{t('home.currentPoints')}</div>
            </div>
            <div
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold"
              style={{ borderColor: style.ring, color: style.ring }}
            >
              {style.icon}
              {tier.name}
            </div>
          </div>

          {nextTier ? (
            <div className="mt-3">
              <div className="mb-1 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-linear-to-r from-violet-600 to-fuchsia-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t('home.pointsToNext', {
                  count: formatNum(Math.max(0, nextTier.minPoints - summary.points)),
                  name: nextTier.name,
                })}
              </div>
            </div>
          ) : (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-50 p-2 text-[11px] font-semibold text-violet-700">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {t('home.topTierReached')}
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full gap-1 text-violet-700 hover:bg-violet-50"
            onClick={() => navigate({ to: '/account/loyalty' })}
          >
            {t('accountPage.console.viewLoyaltyDetails')}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </ConsoleCard>
  )
}
