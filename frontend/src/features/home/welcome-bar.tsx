import { useQuery } from '@tanstack/react-query'
import { bookingsListOptions } from '@/api'
import { useSession } from '@/stores/session'
import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { CalendarClock, ChevronRight, Sparkles } from 'lucide-react'
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
  // One slim pill: who you are, your upcoming tickets, one tap to your console.
  return (
    <button
      type="button"
      onClick={() => navigate({ to: '/account' })}
      title={t('nav.myConsole')}
      className="mt-6 inline-flex max-w-full items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1 text-sm text-white ring-1 ring-white/20 backdrop-blur-md transition-colors hover:bg-white/15"
    >
      <Avatar className="size-7 shrink-0">
        <AvatarFallback className="bg-white/20 text-[11px] font-semibold text-white">
          {firstName ? firstName[0].toUpperCase() : 'U'}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 truncate font-medium">
        {t('home.welcomeBack', { name: firstName || (user?.name ?? '') })}
      </span>
      {activeCount > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-200">
          <CalendarClock className="size-3.5" aria-hidden />
          {t('home.welcomeActiveTickets', { count: activeCount })}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-white/70" aria-hidden />
    </button>
  )
}
