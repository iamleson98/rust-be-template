'use client'

/**
 * Account route — `/account/loyalty` — the full loyalty page.
 *
 * REAL-DATA REWORK (2026-09): everything on this page comes from the
 * backend loyalty summary (`GET /api/loyalty`), computed from the
 * user's completed bookings — 1 point per 10,000 VND of booking total.
 * Tiers, benefit codes, the next-tier progress and the per-booking
 * earning history are all backend-owned; this page only styles them.
 */

import { useQuery } from '@tanstack/react-query'
import { loyaltySummaryOptions } from '@/api'
import { usePrefs } from '@/stores/prefs'
import { useSession } from '@/stores/session'
import { useT } from '@/lib/i18n'
import { ConsolePage, PageHeader } from '@/components/console/page'
import { EmptyState, Panel } from '@/components/console/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Bus, History, LogIn, Sparkles, Trophy } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { BENEFIT_LABELS, DEFAULT_TIER_STYLE, TIER_STYLES } from '@/features/loyalty/tier-styles'

function formatShortVND(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ₫`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} triệu₫`
  return `${n.toLocaleString('vi-VN')}₫`
}

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function AccountLoyaltyPage() {
  const user = useSession((s) => s.user)
  const lang = usePrefs((s) => s.lang)
  const t = useT()
  const navigate = useNavigate()
  const locale = lang === 'en' ? 'en-US' : 'vi-VN'

  // Real backend summary — auth-guarded, only fetched when signed in.
  const { data: summary, isLoading } = useQuery({ ...loyaltySummaryOptions(), enabled: !!user })

  const tier = summary?.tier
  const nextTier = summary?.nextTier
  const style = tier ? (TIER_STYLES[tier.key] ?? DEFAULT_TIER_STYLE) : DEFAULT_TIER_STYLE
  const progress =
    summary && tier && nextTier
      ? Math.min(
          100,
          Math.max(
            0,
            ((summary.points - tier.minPoints) / Math.max(1, nextTier.minPoints - tier.minPoints)) *
              100,
          ),
        )
      : 100

  if (!user) {
    return (
      <ConsolePage width="narrow">
        <Panel>
          <EmptyState
            icon={<LogIn />}
            text={
              <>
                <span className="block font-medium text-foreground">
                  {t('home.loyaltyLoginTitle')}
                </span>
                {t('home.loyaltyLoginDesc')}
              </>
            }
            action={
              <Button size="sm" onClick={() => navigate({ to: '/login' })}>
                {t('auth.login')}
              </Button>
            }
          />
        </Panel>
      </ConsolePage>
    )
  }

  return (
    <ConsolePage>
      <PageHeader title={t('nav.loyalty')} description={t('home.earnRateExplainerShort')} />

      {/* Points, tier and progress */}
      <Panel>
        {isLoading || !summary ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div
                className="grid size-14 shrink-0 place-items-center rounded-xl border-2"
                style={{ borderColor: style.ring, color: style.ring }}
                aria-hidden
              >
                {style.icon}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{t('home.currentPoints')}</div>
                <div className="text-3xl font-semibold tracking-tight tabular-nums">
                  {summary.points.toLocaleString(locale)}
                </div>
                <div className="text-sm font-medium" style={{ color: style.ring }}>
                  {summary.tier.name}
                </div>
              </div>
            </div>

            {nextTier ? (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{summary.tier.name}</span>
                  <span>
                    {nextTier.name} · {nextTier.minPoints.toLocaleString(locale)}{' '}
                    {t('home.pointsUnit')}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {t('home.pointsToNext', {
                    count: Math.max(0, nextTier.minPoints - summary.points).toLocaleString(locale),
                    name: nextTier.name,
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-violet-700 dark:text-violet-300">
                <Trophy className="size-4" aria-hidden />
                {t('home.topTierReached')}
              </div>
            )}

            {/* Lifetime numbers, all from the backend summary */}
            <dl className="mt-4 grid grid-cols-3 divide-x border-t pt-4 text-center">
              <div className="px-1">
                <dd className="text-lg font-semibold tabular-nums">
                  {summary.completedTrips.toLocaleString(locale)}
                </dd>
                <dt className="text-[11px] text-muted-foreground">
                  {t('home.completedTripsCount')}
                </dt>
              </div>
              <div className="px-1">
                <dd className="text-lg font-semibold tabular-nums">
                  {formatShortVND(summary.totalSpent)}
                </dd>
                <dt className="text-[11px] text-muted-foreground">{t('home.totalSpentCount')}</dt>
              </div>
              <div className="px-1">
                <dd className="text-lg font-semibold tabular-nums">
                  +{(summary.history[0]?.points ?? 0).toLocaleString(locale)}
                </dd>
                <dt className="text-[11px] text-muted-foreground">{t('home.lastTripEarned')}</dt>
              </div>
            </dl>
          </>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Panel
          icon={<Sparkles />}
          title={tier ? t('home.tierBenefits', { name: tier.name }) : t('home.tierBenefitsTitle')}
        >
          {isLoading || !summary || !tier ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-3/4" />
              ))}
            </div>
          ) : (
            <ul className="space-y-2">
              {tier.benefitCodes.map((code) => (
                <li key={code} className="flex items-center gap-2 text-sm">
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {BENEFIT_LABELS[code] ? t(BENEFIT_LABELS[code]) : code}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={<History />} title={t('home.pointsHistory')}>
          {isLoading || !summary ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : summary.history.length === 0 ? (
            <EmptyState
              icon={<Bus />}
              text={t('home.historyEmpty')}
              action={
                <Button variant="outline" size="sm" onClick={() => navigate({ to: '/' })}>
                  {t('home.bookATrip')}
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {summary.history.map((h) => (
                <li key={h.bookingId} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {h.routeName ?? h.bookingCode}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(h.departureAt, locale)} ·{' '}
                      <code className="font-mono">{h.bookingCode}</code> · {formatShortVND(h.total)}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-600">
                    +{h.points.toLocaleString(locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </ConsolePage>
  )
}
