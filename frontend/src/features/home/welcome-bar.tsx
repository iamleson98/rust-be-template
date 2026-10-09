import { useQuery } from '@tanstack/react-query'
import { bookingsListOptions } from '@/api'
import { useSession } from '@/stores/session'
import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { CalendarClock, ChevronRight, LayoutDashboard, Sparkles } from 'lucide-react'
import { isBookingUpcoming } from '@/features/booking/history/booking-types'

export function WelcomeBar() {
  const t = useT()
  const navigate = useNavigate()
  const user = useSession((s) => s.user)

  // Only authenticated users trigger the fetch — guests render instantly.
  const bookingsQuery = useQuery({
    ...bookingsListOptions(),
    enabled: !!user,
  })
  const activeCount = useMemo(() => {
    if (!user || !bookingsQuery.data) return 0
    return bookingsQuery.data.items.filter(isBookingUpcoming).length
  }, [user, bookingsQuery.data])

  const firstName = (user?.name ?? '').trim().split(/\s+/).slice(-1)[0] ?? ''

  if (!user) {
    // ── Guest: a quiet one-line welcome — kept deliberately subtle so
    // it never competes with the h1 or the search widget for attention. ──
    return (
      <div className="mt-6 inline-flex max-w-full items-center gap-x-2.5 rounded-full bg-white/10 px-3.5 py-1.5 ring-1 ring-white/20 backdrop-blur-md">
        <Sparkles className="size-3.5 shrink-0 text-amber-300" aria-hidden />
        <span className="text-sm font-semibold text-white">{t('home.welcomeGuest')}</span>
        <span className="hidden items-center gap-1.5 text-xs text-blue-100/80 sm:inline-flex">
          {t('home.welcomeGuestSteps')}
        </span>
      </div>
    )
  }

  // ── Signed in: personal greeting + real active-ticket count — a slim
  // pill row, not a banner: the search widget below is the star. ──
  return (
    <div className="mt-6 flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/20 backdrop-blur-md sm:px-3.5">
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
