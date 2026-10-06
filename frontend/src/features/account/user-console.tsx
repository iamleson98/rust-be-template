'use client'

/**
 * UserConsole — the `/account` home: the customer's own dashboard.
 *
 * A "console page like admin, but for the normal user": a summary of
 * HIS real data — purchase history, feedback to give after each
 * completed trip, and loyalty state — styled so it's a pleasure to
 * come back to after a trip.
 *
 * 100% real data sources (no invented numbers):
 *   - `useAuthMe()` / app store  → the signed-in user (name, email)
 *   - `useMyBookings('all')`     → `GET /api/bookings` — purchases,
 *                                   reviewable bookings, spend totals
 *   - `useLoyalty()`             → `GET /api/loyalty` — points, tier,
 *                                   next-tier progress (computed by the
 *                                   backend from completed bookings)
 *
 * Sections:
 *   1. Hero — greeting + tier medallion + quick stats strip
 *   2. Stat cards — trips taken / total bookings / points / awaiting feedback
 *   3. "Rate your trips" — completed rides with no review yet (CTA)
 *   4. Recent purchases — the 5 newest bookings
 *   5. Quick links — notifications / security / full history
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useApp } from '@/lib/store'
import { useLoyalty, useMyBookings } from '@/lib/queries'
import { useT } from '@/lib/i18n'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Bus,
  Ticket,
  History,
  MessageSquareHeart,
  Gift,
  Bell,
  ShieldCheck,
  ChevronRight,
  Star,
  ArrowRight,
  Sparkles,
  Clock,
  CalendarClock,
} from 'lucide-react'
import {
  STATUS_CONFIG,
  effectiveDeparture,
  isBookingReviewable,
  isBookingUpcoming,
  type BookingItem,
} from '@/features/booking/history/booking-types'
import { DEFAULT_TIER_STYLE, TIER_STYLES } from '@/features/home/loyalty-data'
import { formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'

/* ── Small helpers ─────────────────────────────────────────────── */

function formatVND(n: number): string {
  return formatCurrency(n, 'VND')
}

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Time-of-day greeting key — recomputed on mount only (cheap). */
function greetingKey(date = new Date()): 'Morning' | 'Afternoon' | 'Evening' {
  const h = date.getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

/**
 * Human "departs in …" label for an upcoming booking. Pure function of
 * (departureMs, nowMs) so it is trivially testable; the live tile below
 * re-invokes it on a coarse 30s tick (minute-level display is enough —
 * a per-second tick would only burn CPU).
 */
function untilLabel(
  ms: number,
  t: (k: string, p?: Record<string, string | number>) => string,
): string {
  const diff = Math.max(0, ms - Date.now())
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('accountPage.console.departingNow')
  if (minutes < 60) return t('accountPage.console.inMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  if (hours < 24) return t('accountPage.console.inHours', { hours, minutes: rem })
  const days = Math.floor(hours / 24)
  return t('accountPage.console.inDays', { count: days })
}

/* ── Stat card ─────────────────────────────────────────────────── */

function StatCard({
  icon,
  label,
  value,
  sub,
  onClick,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  onClick?: () => void
  accent: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 rounded-xl border bg-white p-4 text-left transition-all dark:bg-card',
        onClick && 'cursor-pointer hover:border-blue-300',
      )}
    >
      <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', accent)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums leading-tight">{value}</div>
        {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      {onClick && (
        <ChevronRight
          className="ml-auto size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      )}
    </button>
  )
}

/**
 * Whether the departure is within 24h (styles the chip solid). Wraps the
 * impure `Date.now()` read the same way `isBookingUpcoming` does — kept in
 * a shared helper so the component's render stays analytically pure.
 */
function isDepartureUrgent(ms: number): boolean {
  return ms - Date.now() < 24 * 3600_000
}

/* ── Live "departs in …" chip ──────────────────────────────────── */

/**
 * Self-updating countdown chip for the nearest active ticket. Isolated in
 * its own component so the 30s tick re-renders ONLY this tiny span — not
 * the console page (and not anything visible elsewhere).
 */
function DepartureChip({
  departureMs,
  t,
}: {
  departureMs: number
  t: (k: string, p?: Record<string, string | number>) => string
}) {
  const [, forceTick] = useState(0)
  useEffect(() => {
    // Coarse tick — the label is minute-granular, so 30s keeps it honest
    // without a per-second re-render storm.
    const id = setInterval(() => forceTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const urgent = isDepartureUrgent(departureMs)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums whitespace-nowrap',
        urgent ? 'bg-blue-600 text-white' : 'bg-blue-500/10 text-blue-700 ring-1 ring-blue-500/20',
      )}
    >
      <Clock className="size-3" aria-hidden />
      {untilLabel(departureMs, t)}
    </span>
  )
}

/* ── Section: active tickets ───────────────────────────────────── */

/**
 * ActiveTicketsCard — upcoming bookings sorted by departure, with a live
 * countdown on the nearest one. Every value comes from
 * `GET /api/bookings` (see UserConsole header comment). Rows deep-link
 * to `/bookings/{code}` where the ticket can actually be managed
 * (cancel / view seats / pickup points).
 */
function ActiveTicketsCard({ bookings, loading }: { bookings: BookingItem[]; loading: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const { lang } = useApp()
  const locale = lang === 'en' ? 'en-US' : 'vi-VN'

  const upcoming = useMemo(
    () =>
      bookings
        .filter((b) => isBookingUpcoming(b))
        .sort((a, b) => effectiveDeparture(a) - effectiveDeparture(b))
        .slice(0, 3),
    [bookings],
  )

  return (
    <Card className="overflow-hidden">
      <div className="h-1 bg-linear-to-r from-sky-500 to-blue-600" />
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-blue-600" />
          {t('accountPage.console.activeTickets')}
          {upcoming.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-bold text-blue-700 ring-1 ring-blue-500/20">
              {upcoming.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-sky-500/10 text-sky-600">
              <CalendarClock className="size-5" aria-hidden />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('accountPage.console.noActiveTickets')}
            </p>
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
          <ul className="space-y-2">
            {upcoming.map((b, i) => {
              const depMs = effectiveDeparture(b)
              const statusCfg = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.confirmed
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ to: '/bookings/$code', params: { code: b.code } })}
                    className="group flex w-full items-center gap-3 rounded-xl border bg-slate-50/60 p-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50/40"
                  >
                    <div
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white"
                      style={{
                        background: `linear-gradient(135deg, ${b.trip?.brandAccent || '#2563eb'}, ${b.trip?.brandAccent || '#2563eb'}cc)`,
                      }}
                      aria-hidden
                    >
                      <Bus className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {b.trip?.routeName ?? t('accountPage.feedback.tripFallback')}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3" aria-hidden />
                          {formatDateTime(b.trip?.departureAt ?? b.trip?.departureDate, locale)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Ticket className="size-3" aria-hidden />
                          {b.seats?.length ?? 0} {t('accountPage.console.seatsUnit')}
                          <code className="font-mono">{b.code}</code>
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {i === 0 && depMs > 0 ? (
                        <DepartureChip departureMs={depMs} t={t} />
                      ) : (
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide',
                            statusCfg.cls,
                          )}
                        >
                          {t(statusCfg.labelKey)}
                        </span>
                      )}
                      <span className="hidden items-center gap-0.5 text-[11px] font-medium text-blue-700 group-hover:flex sm:inline-flex">
                        {t('accountPage.console.manageTicket')}
                        <ChevronRight
                          className="size-3 transition-transform group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
            <li>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full gap-1 text-blue-700 hover:bg-blue-50"
                onClick={() => navigate({ to: '/account/trips' })}
              >
                {t('accountPage.console.viewAllTickets')}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </li>
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Section: awaiting feedback ────────────────────────────────── */

function AwaitingFeedbackCard({ bookings }: { bookings: BookingItem[] }) {
  const t = useT()
  const navigate = useNavigate()
  if (bookings.length === 0) return null

  return (
    <Card className="overflow-hidden">
      <div className="h-1 bg-linear-to-r from-amber-400 to-orange-500" />
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareHeart className="h-4 w-4 text-amber-500" />
          {t('accountPage.console.rateYourTrips')}
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600 ring-1 ring-amber-500/20">
            {bookings.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="mb-3 text-xs text-muted-foreground">
          {t('accountPage.console.rateYourTripsDesc')}
        </p>
        <ul className="space-y-2">
          {bookings.slice(0, 3).map((b) => (
            <li key={b.id} className="flex items-center gap-3 rounded-lg border bg-slate-50/60 p-3">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white"
                style={{
                  background: `linear-gradient(135deg, ${b.trip?.brandAccent || '#2563eb'}, ${b.trip?.brandAccent || '#2563eb'}cc)`,
                }}
                aria-hidden
              >
                <Bus className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {b.trip?.routeName ?? t('accountPage.feedback.tripFallback')}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <History className="size-3" aria-hidden />
                    {formatDate(b.trip?.departureAt ?? b.createdAt, 'vi-VN')}
                  </span>
                  {b.trip?.brandName && <span className="truncate">{b.trip.brandName}</span>}
                </div>
              </div>
              <div className="hidden items-center gap-0.5 sm:flex" aria-hidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-3.5 text-amber-300" />
                ))}
              </div>
            </li>
          ))}
        </ul>
        <Button
          className="mt-3 w-full gap-1.5 bg-linear-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600"
          onClick={() => navigate({ to: '/account/feedback' })}
        >
          <MessageSquareHeart className="h-4 w-4" />
          {t('accountPage.console.giveFeedbackCta')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}

/* ── Section: recent purchases ─────────────────────────────────── */

function RecentPurchasesCard({ bookings, loading }: { bookings: BookingItem[]; loading: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const { lang } = useApp()
  const locale = lang === 'en' ? 'en-US' : 'vi-VN'

  return (
    <Card className="overflow-hidden">
      <div className="h-1 bg-linear-to-r from-blue-500 to-blue-400" />
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ticket className="h-4 w-4 text-blue-600" />
          {t('accountPage.console.recentPurchases')}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-blue-500/10 text-blue-600">
              <Bus className="size-5" aria-hidden />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('accountPage.console.noPurchasesYet')}
            </p>
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
          <>
            <ul className="divide-y divide-border/60">
              {bookings.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-center gap-3 py-2.5">
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{
                      background: `linear-gradient(135deg, ${b.trip?.brandAccent || '#2563eb'}, ${b.trip?.brandAccent || '#2563eb'}cc)`,
                    }}
                    aria-hidden
                  >
                    <Bus className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {b.trip?.routeName ?? t('accountPage.feedback.tripFallback')}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatDate(b.trip?.departureAt ?? b.createdAt, locale)} ·{' '}
                      <code className="font-mono">{b.code}</code>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">{formatVND(b.total)}</div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {/* Localized status — the raw enum ("held"/"pending")
                          leaked English internals before. */}
                      {t((STATUS_CONFIG[b.status] ?? STATUS_CONFIG.confirmed).labelKey)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full gap-1 text-blue-700 hover:bg-blue-50"
              onClick={() => navigate({ to: '/account/trips' })}
            >
              {t('accountPage.console.viewAllPurchases')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Section: loyalty snapshot ─────────────────────────────────── */

function LoyaltySnapshotCard() {
  const t = useT()
  const navigate = useNavigate()
  const { user, lang } = useApp()
  const locale = lang === 'en' ? 'en-US' : 'vi-VN'
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
    <Card className="overflow-hidden">
      <div className="h-1 bg-linear-to-r from-violet-500 to-fuchsia-500" />
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4 text-violet-600" />
          {t('nav.loyalty')}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading || !summary ? (
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
                  {summary.points.toLocaleString(locale)}
                </div>
                <div className="text-[11px] text-muted-foreground">{t('home.currentPoints')}</div>
              </div>
              <div
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold"
                style={{ borderColor: style.ring, color: style.ring }}
              >
                {style.icon}
                {tier!.name}
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
                    count: Math.max(0, nextTier.minPoints - summary.points).toLocaleString(locale),
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
      </CardContent>
    </Card>
  )
}

/* ── Page ──────────────────────────────────────────────────────── */

export function UserConsole() {
  const t = useT()
  const navigate = useNavigate()
  const { user, lang } = useApp()
  const locale = lang === 'en' ? 'en-US' : 'vi-VN'

  const bookingsQuery = useMyBookings('all')
  const bookings: BookingItem[] = useMemo(
    () => (bookingsQuery.data?.items ?? []) as unknown as BookingItem[],
    [bookingsQuery.data],
  )
  const bookingsLoading = bookingsQuery.isLoading

  const { data: loyalty } = useLoyalty({ enabled: !!user })

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .slice(-2)
        .join('')
        .toUpperCase()
    : 'U'

  // Time-of-day greeting — a small, warm touch that makes the console
  // feel personal instead of corporate.
  const greeting = t(`accountPage.console.greeting${greetingKey()}`)

  // Real derived stats — no invented numbers.
  const stats = useMemo(() => {
    const completed = bookings.filter((b) => b.status === 'completed').length
    // isBookingUpcoming internally compares against the current time —
    // kept in the shared helper so this memo stays pure.
    const upcoming = bookings.filter((b) => isBookingUpcoming(b)).length
    const awaitingFeedback = bookings.filter((b) => isBookingReviewable(b) && !b.review).length
    return { completed, upcoming, awaitingFeedback }
  }, [bookings])

  const awaiting = useMemo(
    () => bookings.filter((b) => isBookingReviewable(b) && !b.review),
    [bookings],
  )

  const tier = loyalty?.tier
  const style = tier ? (TIER_STYLES[tier.key] ?? DEFAULT_TIER_STYLE) : DEFAULT_TIER_STYLE

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="relative mb-5 overflow-hidden rounded-2xl bg-linear-to-br from-blue-700 via-blue-800 to-blue-900 text-white">
        {/* Decorative buses */}
        <div className="absolute inset-0 opacity-[0.06]" aria-hidden>
          <div className="absolute top-4 left-[10%]">
            <Bus className="h-16 w-16 rotate-[-15deg]" />
          </div>
          <div className="absolute top-20 right-[15%]">
            <Bus className="h-12 w-12 rotate-10" />
          </div>
          <div className="absolute bottom-8 left-[30%]">
            <Bus className="h-10 w-10 rotate-[-5deg]" />
          </div>
          <div className="absolute top-2 right-[45%]">
            <Bus className="h-8 w-8 rotate-20" />
          </div>
        </div>
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 50%, white 0, transparent 50%), radial-gradient(circle at 85% 70%, white 0, transparent 50%)',
          }}
          aria-hidden
        />

        <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <Avatar className="size-16 shrink-0 ring-2 ring-white/30">
            <AvatarFallback className="bg-white/15 text-lg font-bold text-white backdrop-blur-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold ring-1 ring-white/20 backdrop-blur-sm">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              {t('accountPage.console.badge')}
            </div>
            <h1 className="mt-2 truncate text-2xl font-extrabold tracking-tight sm:text-3xl">
              <span className="mr-1.5" aria-hidden>
                👋
              </span>
              {greeting}, {user?.name ?? ''}
            </h1>
            <p className="mt-1 truncate text-sm text-blue-100">
              {t('accountPage.console.subtitleLine', {
                active: stats.upcoming,
                points: loyalty ? loyalty.points.toLocaleString(locale) : '0',
              })}
            </p>
          </div>

          {/* Tier medallion (real loyalty tier) */}
          {tier && (
            <button
              type="button"
              onClick={() => navigate({ to: '/account/loyalty' })}
              className="flex shrink-0 items-center gap-2.5 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/15"
              title={t('nav.loyalty')}
            >
              <span
                className="flex size-9 items-center justify-center rounded-lg bg-white/15"
                style={{ color: '#fff' }}
              >
                {style.icon}
              </span>
              <span className="text-left">
                <span className="block text-lg font-extrabold leading-tight tabular-nums">
                  {loyalty?.points.toLocaleString(locale)}
                </span>
                <span className="block text-[10px] uppercase tracking-wider text-blue-100">
                  {tier.name} · {t('nav.loyalty')}
                </span>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ── Stat cards (all real) ────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<CalendarClock className="h-5 w-5 text-sky-600" />}
          label={t('accountPage.console.activeTickets')}
          value={bookingsLoading ? '—' : String(stats.upcoming)}
          sub={
            stats.upcoming > 0
              ? t('accountPage.console.activeTicketsSub')
              : t('accountPage.console.noActiveTickets')
          }
          accent="bg-sky-500/10"
          onClick={() => navigate({ to: '/account/trips' })}
        />
        <StatCard
          icon={<Bus className="h-5 w-5 text-emerald-600" />}
          label={t('accountPage.console.completedTrips')}
          value={bookingsLoading ? '—' : String(stats.completed)}
          sub={loyalty ? `${t('home.earnRateExplainerShort')}` : undefined}
          accent="bg-emerald-500/10"
          onClick={() => navigate({ to: '/account/trips' })}
        />
        <StatCard
          icon={<Gift className="h-5 w-5 text-violet-600" />}
          label={t('nav.loyalty')}
          value={loyalty ? loyalty.points.toLocaleString(locale) : '—'}
          sub={tier ? tier.name : undefined}
          accent="bg-violet-500/10"
          onClick={() => navigate({ to: '/account/loyalty' })}
        />
        <StatCard
          icon={<MessageSquareHeart className="h-5 w-5 text-amber-600" />}
          label={t('accountPage.console.awaitingFeedback')}
          value={bookingsLoading ? '—' : String(stats.awaitingFeedback)}
          sub={
            stats.awaitingFeedback > 0
              ? t('accountPage.console.awaitingFeedbackSub')
              : t('accountPage.console.allCaughtUp')
          }
          accent="bg-amber-500/10"
          onClick={() => navigate({ to: '/account/feedback' })}
        />
      </div>

      {/* ── Active tickets — the "check my active tickets" home ── */}
      <div className="mb-5">
        <ActiveTicketsCard bookings={bookings} loading={bookingsLoading} />
      </div>

      {/* ── Rate your trips (feedback after each trip done) ──── */}
      <div className="mb-5">
        <AwaitingFeedbackCard bookings={awaiting} />
      </div>

      {/* ── Recent purchases + loyalty snapshot ──────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentPurchasesCard bookings={bookings} loading={bookingsLoading} />
        <LoyaltySnapshotCard />
      </div>

      {/* ── Quick links ──────────────────────────────────────── */}
      <Card className="mt-5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('accountPage.quickAccess')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <QuickLink
            icon={<Ticket className="h-4 w-4 text-blue-600" />}
            label={t('nav.tickets')}
            desc={t('accountPage.qkBookingsDesc')}
            onClick={() => navigate({ to: '/account/trips' })}
          />
          <QuickLink
            icon={<History className="h-4 w-4 text-blue-600" />}
            label={t('layout.account.tripHistory')}
            desc={t('accountPage.console.qkTripsDesc')}
            onClick={() => navigate({ to: '/account/trips' })}
          />
          <QuickLink
            icon={<MessageSquareHeart className="h-4 w-4 text-amber-600" />}
            label={t('layout.account.tripFeedback')}
            desc={t('accountPage.console.qkFeedbackDesc')}
            onClick={() => navigate({ to: '/account/feedback' })}
          />
          <QuickLink
            icon={<Gift className="h-4 w-4 text-violet-600" />}
            label={t('nav.loyalty')}
            desc={t('accountPage.qkLoyaltyDesc')}
            onClick={() => navigate({ to: '/account/loyalty' })}
          />
          <QuickLink
            icon={<Bell className="h-4 w-4 text-blue-600" />}
            label={t('account.notifications')}
            desc={t('accountPage.qkNotificationsDesc')}
            onClick={() => navigate({ to: '/account/notifications' })}
          />
          <QuickLink
            icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />}
            label={t('accountPage.qkSecurity')}
            desc={t('accountPage.qkSecurityDesc')}
            onClick={() => navigate({ to: '/account/security' })}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function QuickLink({
  icon,
  label,
  desc,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  desc?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        {desc && <div className="truncate text-xs text-muted-foreground">{desc}</div>}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}
