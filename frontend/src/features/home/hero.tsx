'use client'

import { useQuery } from '@tanstack/react-query'
import { statsOptions } from '@/api'
import { SearchWidget } from '@/features/search/widget/search-widget'
import { TrustBar } from '@/components/seo/trust-signals'
import { useT } from '@/lib/i18n'
import { ChevronDown } from 'lucide-react'
import { HeroBackground } from './hero-background'
import { WelcomeBar } from './welcome-bar'
import { HeroTrustBadges } from './hero-trust-badges'
import { HeroStat } from './hero-stat'
import { HeroTrustedBy } from './hero-trusted-by'

export function Hero() {
  const t = useT()

  // NOTE: the fabricated "Flash Sale" countdown that used to live here was
  // removed — it set a fake 23h59m deadline not backed by any campaign API
  // and its 1-second interval re-rendered the whole hero, hurting both
  // honesty and load/CPU performance. The WelcomeBar below greets the
  // visitor with REAL data instead (active tickets for signed-in users).

  // Real platform stats (brands / routes / trips straight from
  // GET /api/stats). The previous version ALSO showed a made-up
  // "125.000+ passengers" badge and a "Places: 0" stat tile — both gone.
  const { data: statsData } = useQuery(statsOptions())

  return (
    <section className="relative overflow-hidden isolate">
      {/* Background — section is a stacking context (isolate), so bg layers stay behind content but above page bg.
          Natural photography look: clearer image, softer warm-to-neutral overlay instead of heavy blue. */}
      <HeroBackground />

      <div className="relative container mx-auto px-4 pt-12 pb-16 md:pt-20 md:pb-24">
        <div className="max-w-3xl text-white">
          <h1 className="text-balance text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05]">
            <span className="text-white">{t('hero.title')}</span>
            <br />
            <span className="bg-linear-to-r from-amber-300 via-yellow-200 to-amber-300 bg-clip-text text-transparent">
              {t('hero.titleHighlight')}
            </span>
          </h1>
          <p className="mt-5 text-base md:text-lg text-blue-50/95 max-w-2xl leading-relaxed">
            {t('hero.subtitle')}
          </p>
        </div>

        {/* Friendly personalized welcome — real data, no timers */}
        <WelcomeBar />

        {/* Search widget — z-40 lifts the whole widget (and its city
            picker popup) above later siblings like TrustBadges that
            also create their own stacking contexts via backdrop-blur. */}
        <div className="relative z-40 mt-8 md:mt-10">
          <div className="rounded-3xl p-1.5 md:p-2 bg-white/15 ring-1 ring-white/25 backdrop-blur-md">
            <SearchWidget />
          </div>
        </div>

        {/* Trust badges */}
        <HeroTrustBadges />

        {/* Stats — real numbers from the platform */}
        {statsData && (
          <div className="mt-8 grid grid-cols-3 gap-2 text-white sm:gap-4 md:mt-10">
            <HeroStat value={Number(statsData.brands) || 0} label={t('home.statBrands')} />
            <HeroStat value={Number(statsData.routes) || 0} label={t('home.statRoutes')} />
            <HeroStat value={Number(statsData.trips) || 0} label={t('home.statTrips')} />
          </div>
        )}

        {/* Trusted-by logos strip — REAL brands from the API */}
        <HeroTrustedBy />

        {/* Scroll down indicator */}
        <div className="mt-10 flex justify-center">
          <button
            onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}
            className="flex flex-col items-center gap-1 text-white/70 hover:text-white transition-colors"
            aria-label={t('home.scrollDown')}
          >
            <span className="text-[11px] font-bold uppercase tracking-widest">
              {t('home.discover')}
            </span>
            <ChevronDown className="h-5 w-5 animate-bounce" />
          </button>
        </div>
      </div>

      {/* Trust signals bar — SSL + data protection + Decree 13 compliance */}
      <TrustBar className="bg-white/95 dark:bg-slate-900/95 border-t border-border" />
    </section>
  )
}
