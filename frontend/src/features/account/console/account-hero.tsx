import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { tierView, useLoyalty } from '@/features/loyalty/api'
import { formatNum } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useSession } from '@/stores/session'

const GREETINGS = ['Morning', 'Afternoon', 'Evening'] as const
const greetingKey = (hour = new Date().getHours()) => GREETINGS[hour < 12 ? 0 : hour < 18 ? 1 : 2]

/** Who you are and where you stand: greeting, tier, points and the way to the next tier. */
export function AccountHero() {
  const t = useT()
  const user = useSession((s) => s.user)
  const { data: loyalty } = useLoyalty()
  const { tier, nextTier, style, progress } = tierView(loyalty)
  const initials =
    (user?.name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(-2)
      .join('')
      .toUpperCase() || 'U'

  return (
    <section className="relative overflow-hidden rounded-3xl bg-linear-to-br from-primary to-blue-500 p-5 text-white sm:p-6">
      <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/10" />
      <div className="relative flex items-center gap-4">
        <Avatar className="size-14 ring-2 ring-white/40">
          <AvatarFallback className="bg-white/20 text-lg font-bold text-white">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="text-sm text-white/80">
            {t(`accountPage.console.greeting${greetingKey()}`)}
          </div>
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{user?.name}</h1>
        </div>
      </div>

      {loyalty && tier && (
        <Link
          to="/account/loyalty"
          className="relative mt-5 block rounded-2xl bg-white/12 p-4 ring-1 ring-white/20 transition-colors hover:bg-white/18"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden>{style.icon}</span>
              {tier.name}
            </span>
            <span className="inline-flex items-center gap-1 text-sm">
              <span className="text-lg font-bold tabular-nums">{formatNum(loyalty.points)}</span>
              <span className="text-white/80">{t('layout.account.pointsShort').toLowerCase()}</span>
              <ChevronRight className="size-4 text-white/70" />
            </span>
          </div>
          {nextTier ? (
            <>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-amber-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1.5 text-xs text-white/80">
                {t('home.pointsToNext', {
                  count: formatNum(Math.max(0, nextTier.minPoints - loyalty.points)),
                  name: nextTier.name,
                })}
              </div>
            </>
          ) : (
            <div className="mt-1.5 text-xs text-white/80">{t('home.topTierReached')}</div>
          )}
        </Link>
      )}
    </section>
  )
}
