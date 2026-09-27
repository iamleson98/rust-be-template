'use client'

/**
 * WelcomeBar — a small, warm, personalized strip that sits directly above
 * the hero's SearchWidget. It is the "friendly doorman" of the site:
 *
 *   - Signed in  → greeting with the user's first name, their REAL
 *                  active-ticket count (from GET /api/bookings — same
 *                  TanStack Query cache the bookings page uses) and one
 *                  tap into their personal console (/account).
 *   - Guest      → a cheerful welcome + the 3-step reassurance
 *                  (pick → book → board). No queries, no timers — the
 *                  guest path renders pure static markup.
 *
 * Performance notes:
 *   - No intervals, no animations, no images — it paints with the hero.
 *   - The bookings query is enabled ONLY for authenticated users and is
 *     deduped/cached by TanStack Query (staleTime inherited), so repeat
 *     visits don't refetch while the cache is fresh.
 */

import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useApp } from '@/lib/store'
import { useMyBookings } from '@/lib/queries'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { CalendarClock, ChevronRight, LayoutDashboard, Sparkles } from 'lucide-react'
import { isBookingUpcoming, type BookingItem } from '@/features/booking/history/booking-types'

export function WelcomeBar() {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useApp()

  // Only authenticated users trigger the fetch — guests render instantly.
  const bookingsQuery = useMyBookings('all', { enabled: !!user })
  const activeCount = useMemo(() => {
    if (!user || !bookingsQuery.data) return 0
    const items = (bookingsQuery.data.items ?? []) as unknown as BookingItem[]
    return items.filter((b) => isBookingUpcoming(b)).length
  }, [user, bookingsQuery.data])

  const firstName = (user?.name ?? '').trim().split(/\s+/).slice(-1)[0] ?? ''

  if (!user) {
    // ── Guest: cheerful welcome + 3-step reassurance ──
    return (
      <div className="mt-6 inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-white/12 px-4 py-2.5 ring-1 ring-white/25 backdrop-blur-md">
        <span className="text-lg leading-none" aria-hidden>👋</span>
        <span className="text-sm font-semibold text-white">{t('home.welcomeGuest')}</span>
        <span className="hidden items-center gap-1.5 text-xs text-blue-100/90 sm:inline-flex">
          <Sparkles className="size-3.5 text-amber-300" aria-hidden />
          {t('home.welcomeGuestSteps')}
        </span>
      </div>
    )
  }

  // ── Signed in: personal greeting + real active-ticket count ──
  return (
    <div className="mt-6 flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-white/12 px-3 py-2 ring-1 ring-white/25 backdrop-blur-md sm:px-4 sm:py-2.5">
      <Avatar className="size-8 shrink-0 ring-1 ring-white/40">
        <AvatarFallback className="bg-linear-to-br from-blue-400 to-blue-500 text-[11px] font-bold text-white">
          {firstName ? firstName[0].toUpperCase() : 'U'}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 truncate text-sm font-semibold text-white">
        {t('home.welcomeBack', { name: firstName || (user?.name ?? '') })}
      </span>

      {bookingsQuery.isLoading ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-blue-100">
          <CalendarClock className="size-3.5" aria-hidden />
          {t('home.welcomeLoading')}
        </span>
      ) : activeCount > 0 ? (
        <button
          type="button"
          onClick={() => navigate({ to: '/account' })}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-2.5 py-1 text-[11px] font-bold text-emerald-100 ring-1 ring-emerald-300/40 transition-colors hover:bg-emerald-400/30"
          title={t('nav.myConsole')}
        >
          <CalendarClock className="size-3.5" aria-hidden />
          {t('home.welcomeActiveTickets', { count: activeCount })}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-blue-100">
          <Sparkles className="size-3.5 text-amber-300" aria-hidden />
          {t('home.welcomeNoActive')}
        </span>
      )}

      {/* One tap to the personal console */}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-8 gap-1.5 rounded-full bg-white/15 px-3 text-xs font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/25 hover:text-white"
        onClick={() => navigate({ to: '/account' })}
      >
        <LayoutDashboard className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">{t('nav.myConsole')}</span>
        <ChevronRight className="size-3.5" aria-hidden />
      </Button>
    </div>
  )
}
