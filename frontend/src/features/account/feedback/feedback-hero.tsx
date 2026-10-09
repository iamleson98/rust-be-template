import { MessageSquareHeart, PartyPopper, Star } from 'lucide-react'
import { useT } from '@/lib/i18n'

function Chip({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode
  value: string | number
  label: string
  tone: 'blue' | 'emerald'
}) {
  const [chip, text] =
    tone === 'blue'
      ? ['bg-white/10 ring-white/20', 'text-blue-100']
      : ['bg-emerald-400/15 ring-emerald-300/25', 'text-emerald-100']
  return (
    <div className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm ring-1 backdrop-blur ${chip}`}>
      {icon}
      <span className="font-semibold tabular-nums">{value}</span>
      <span className={text}>{label}</span>
    </div>
  )
}

/** Blue banner with the customer's rating stats. */
export function FeedbackHero({
  average,
  sent,
  approved,
}: {
  average: number
  sent: number
  approved: number
}) {
  const t = useT()
  return (
    <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-blue-600 via-blue-700 to-indigo-700 px-5 py-6 text-white md:px-7 md:py-7">
      <div
        className="pointer-events-none absolute -right-8 -top-10 select-none text-[10rem] leading-none opacity-[0.12]"
        aria-hidden
      >
        🚌
      </div>
      <div className="relative">
        <h1 className="flex items-center gap-2.5 text-xl font-bold md:text-2xl">
          <MessageSquareHeart className="size-6 text-amber-300" />
          {t('accountPage.feedback.heroTitle')}
        </h1>
        <p className="mt-1.5 max-w-xl text-sm text-blue-100">{t('accountPage.feedback.heroDesc')}</p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Chip
            tone="blue"
            icon={<Star className="size-4 fill-amber-300 text-amber-300" />}
            value={average > 0 ? average.toFixed(1) : '—'}
            label={t('accountPage.feedback.avgGiven')}
          />
          <Chip
            tone="blue"
            icon={<PartyPopper className="size-4 text-amber-300" />}
            value={sent}
            label={t('accountPage.feedback.sentCount')}
          />
          {approved > 0 && (
            <Chip
              tone="emerald"
              icon={<Star className="size-4 fill-emerald-300 text-emerald-300" />}
              value={approved}
              label={t('accountPage.feedback.publicCount')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
