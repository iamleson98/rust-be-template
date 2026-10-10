import { useQuery } from '@tanstack/react-query'
import { Armchair, BusFront, QrCode, ShieldCheck } from 'lucide-react'
import { statsOptions } from '@/api'
import { SearchWidget } from '@/features/search/widget/search-widget'
import { formatNum } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { HeroBackground } from './hero-background'
import { WelcomeBar } from './welcome-bar'

/** What the product really does for a traveller — features, not claims. */
const FEATURES = [
  { icon: BusFront, title: 'home.featureCompare', body: 'home.featureCompareBody' },
  { icon: Armchair, title: 'home.featureSeats', body: 'home.featureSeatsBody' },
  { icon: QrCode, title: 'home.featureTicket', body: 'home.featureTicketBody' },
  { icon: ShieldCheck, title: 'home.featurePay', body: 'home.featurePayBody' },
] as const

/**
 * The landing hero: a framed photo with the promise, the search card lifted
 * over its lower edge (the one thing to do here), then what booking here gets
 * you. Platform numbers come straight from `GET /api/stats`.
 */
export function Hero() {
  const t = useT()
  const { data: stats } = useQuery(statsOptions())
  const counts = stats
    ? [
        { value: Number(stats.brands) || 0, label: t('home.statBrands') },
        { value: Number(stats.routes) || 0, label: t('home.statRoutes') },
        { value: Number(stats.trips) || 0, label: t('home.statTrips') },
      ].filter((c) => c.value > 0)
    : []

  return (
    <section className="page-x pt-3 sm:pt-5">
      <div className="relative isolate overflow-hidden rounded-3xl sm:rounded-[2rem]">
        <HeroBackground />
        <div className="px-5 pt-9 pb-24 sm:px-10 sm:pt-14 sm:pb-32 lg:px-14 lg:pt-20 lg:pb-40">
          <h1 className="max-w-2xl text-[2rem] leading-[1.08] font-extrabold tracking-tight text-balance text-white sm:text-5xl lg:text-6xl">
            {t('hero.title')} <span className="text-amber-300">{t('hero.titleHighlight')}</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/85 sm:text-lg">
            {t('hero.subtitle')}
          </p>
          <WelcomeBar />
          {counts.length > 0 && (
            <dl className="mt-6 hidden flex-wrap gap-x-6 gap-y-2 text-white sm:flex">
              {counts.map((c) => (
                <div key={c.label} className="flex items-baseline gap-1.5">
                  <dt className="sr-only">{c.label}</dt>
                  <dd className="text-xl font-bold tabular-nums">{formatNum(c.value)}</dd>
                  <span className="text-sm text-white/70">{c.label}</span>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {/* Lifted over the photo's lower edge; z-30 keeps its place picker above later sections. */}
      <div className="relative z-30 -mt-16 sm:-mt-20 sm:px-4 lg:-mt-24 lg:px-10">
        <SearchWidget />
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-x-3 gap-y-4 sm:mt-10 sm:gap-x-4 sm:gap-y-6 lg:grid-cols-4 lg:px-10">
        {FEATURES.map((f) => (
          <li key={f.title} className="flex items-center gap-3 sm:items-start">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <f.icon className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] leading-snug font-semibold text-slate-900 sm:text-sm">
                {t(f.title)}
              </div>
              {/* Phones: the titles say enough; the detail would crowd the half-width cells. */}
              <p className="mt-0.5 hidden text-[13px] leading-relaxed text-slate-500 sm:block">
                {t(f.body)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
