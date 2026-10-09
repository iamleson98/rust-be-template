import { useNavigate } from '@tanstack/react-router'
import { Bus, ShieldCheck } from 'lucide-react'
import type { LoyaltyResponse } from '@/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { tierView } from '@/features/loyalty/api'
import { formatNum } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useSession } from '@/stores/session'

const GREETINGS = ['Morning', 'Afternoon', 'Evening'] as const
const greetingKey = (hour = new Date().getHours()) => GREETINGS[hour < 12 ? 0 : hour < 18 ? 1 : 2]

/** Bus silhouettes behind the hero text: [position, size + rotation]. */
const DECOR = [
  ['top-4 left-[10%]', 'h-16 w-16 rotate-[-15deg]'],
  ['top-20 right-[15%]', 'h-12 w-12 rotate-10'],
  ['bottom-8 left-[30%]', 'h-10 w-10 rotate-[-5deg]'],
  ['top-2 right-[45%]', 'h-8 w-8 rotate-20'],
]

/** Greeting banner: avatar, ticket summary line and the loyalty tier medallion. */
export function ConsoleHero({
  upcoming,
  loyalty,
}: {
  upcoming: number
  loyalty?: LoyaltyResponse
}) {
  const t = useT()
  const navigate = useNavigate()
  const user = useSession((s) => s.user)
  const { tier, style } = tierView(loyalty)
  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .slice(-2)
        .join('')
        .toUpperCase()
    : 'U'

  return (
    <div className="relative mb-5 overflow-hidden rounded-2xl bg-linear-to-br from-blue-700 via-blue-800 to-blue-900 text-white">
      <div className="absolute inset-0 opacity-[0.06]" aria-hidden>
        {DECOR.map(([position, shape]) => (
          <div key={position} className={`absolute ${position}`}>
            <Bus className={shape} />
          </div>
        ))}
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
            {t(`accountPage.console.greeting${greetingKey()}`)}, {user?.name ?? ''}
          </h1>
          <p className="mt-1 truncate text-sm text-blue-100">
            {t('accountPage.console.subtitleLine', {
              active: upcoming,
              points: loyalty ? formatNum(loyalty.points) : '0',
            })}
          </p>
        </div>

        {tier && (
          <button
            type="button"
            onClick={() => navigate({ to: '/account/loyalty' })}
            className="flex shrink-0 items-center gap-2.5 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/15"
            title={t('nav.loyalty')}
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-white/15 text-white">
              {style.icon}
            </span>
            <span className="text-left">
              <span className="block text-lg font-extrabold leading-tight tabular-nums">
                {formatNum(loyalty?.points ?? 0)}
              </span>
              <span className="block text-[10px] uppercase tracking-wider text-blue-100">
                {tier.name} · {t('nav.loyalty')}
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
