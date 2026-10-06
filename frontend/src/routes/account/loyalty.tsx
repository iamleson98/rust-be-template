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

import { useLoyalty } from '@/lib/queries'
import { useApp } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Bus, History, LogIn, Sparkles, Trophy } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { BENEFIT_LABELS, DEFAULT_TIER_STYLE, TIER_STYLES } from '@/features/home/loyalty-data'

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
  const { user, lang } = useApp()
  const t = useT()
  const navigate = useNavigate()
  const locale = lang === 'en' ? 'en-US' : 'vi-VN'

  // Real backend summary — auth-guarded, only fetched when signed in.
  const { data: summary, isLoading } = useLoyalty({ enabled: !!user })

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

  return (
    <div className="page-transition">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-6">
        {/* ── Hero: points + tier ── */}
        <Card className="overflow-hidden">
          <div className="h-1.5 bg-linear-to-r from-blue-500 via-blue-400 to-blue-500" />
          <CardContent className="p-0">
            {!user ? (
              <div className="flex flex-col items-center gap-3 p-10 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                  <LogIn className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-semibold">{t('home.loyaltyLoginTitle')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('home.loyaltyLoginDesc')}</p>
                </div>
                <Button size="sm" className="gap-1.5" onClick={() => navigate({ to: '/login' })}>
                  <LogIn className="h-3.5 w-3.5" /> {t('auth.login')}
                </Button>
              </div>
            ) : isLoading || !summary ? (
              <div className="space-y-4 p-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="size-16 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-4 w-56" />
                  </div>
                </div>
                <Skeleton className="h-2.5 w-full rounded-full" />
                <div className="grid grid-cols-3 gap-3">
                  <Skeleton className="h-16 rounded-lg" />
                  <Skeleton className="h-16 rounded-lg" />
                  <Skeleton className="h-16 rounded-lg" />
                </div>
              </div>
            ) : (
              <div className="p-6">
                <div className="flex items-center gap-4">
                  {/* Tier medallion */}
                  <div
                    className="flex size-16 shrink-0 items-center justify-center rounded-2xl border-2"
                    style={{ borderColor: style.ring, color: style.ring }}
                  >
                    {style.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {t('home.currentPoints')}
                    </div>
                    <div className="text-4xl font-extrabold tabular-nums text-blue-700">
                      {summary.points.toLocaleString(locale)}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-semibold" style={{ color: style.ring }}>
                        {summary.tier.name}
                      </span>
                      <span>·</span>
                      <span>{t('home.earnRateExplainerShort')}</span>
                    </div>
                  </div>
                </div>

                {/* Progress to next tier */}
                {nextTier ? (
                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="font-semibold" style={{ color: style.ring }}>
                        {summary.tier.name}
                      </span>
                      <span>
                        {nextTier.name} · {nextTier.minPoints.toLocaleString(locale)}{' '}
                        {t('home.pointsUnit')}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-linear-to-r from-blue-600 to-blue-400 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t('home.pointsToNext', {
                        count: Math.max(0, nextTier.minPoints - summary.points).toLocaleString(
                          locale,
                        ),
                        name: nextTier.name,
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-1.5 rounded-lg bg-violet-50 p-2.5 text-xs font-semibold text-violet-700">
                    <Trophy className="h-3.5 w-3.5" aria-hidden />
                    {t('home.topTierReached')}
                  </div>
                )}

                {/* Lifetime stats (real) */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-lg border bg-slate-50 p-3 text-center">
                    <div className="text-lg font-bold tabular-nums">
                      {summary.completedTrips.toLocaleString(locale)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t('home.completedTripsCount')}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3 text-center">
                    <div className="text-lg font-bold tabular-nums">
                      {formatShortVND(summary.totalSpent)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t('home.totalSpentCount')}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3 text-center">
                    <div className="text-lg font-bold tabular-nums text-blue-700">
                      +{summary.history[0]?.points.toLocaleString(locale) ?? 0}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t('home.lastTripEarned')}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Benefits + history (real) ── */}
        {user && (summary || isLoading) && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Tier benefits */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  {isLoading || !summary || !tier
                    ? t('home.tierBenefitsTitle')
                    : t('home.tierBenefits', { name: tier.name })}
                </CardTitle>
              </CardHeader>
              <CardContent>
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
                        <span className="size-1.5 shrink-0 rounded-full bg-blue-500" aria-hidden />
                        {BENEFIT_LABELS[code] ? t(BENEFIT_LABELS[code]) : code}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Earning history (real completed bookings) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4 text-slate-500" />
                  {t('home.pointsHistory')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading || !summary ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))}
                  </div>
                ) : summary.history.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                    <Bus className="h-5 w-5" aria-hidden />
                    <p className="text-xs">{t('home.historyEmpty')}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => navigate({ to: '/' })}
                    >
                      <Bus className="h-3.5 w-3.5" /> {t('home.bookATrip')}
                    </Button>
                  </div>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {summary.history.map((h) => (
                      <li key={h.bookingId} className="flex items-center gap-3 py-2.5">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                          <Bus className="size-4" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {h.routeName ?? h.bookingCode}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatDate(h.departureAt, locale)} ·{' '}
                            <code className="font-mono">{h.bookingCode}</code> ·{' '}
                            {formatShortVND(h.total)}
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-blue-600">
                          +{h.points.toLocaleString(locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
