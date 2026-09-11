'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { SearchWidget } from '@/features/home/search-widget'
import { TrustBar } from '@/components/seo/trust-signals'
import { useT } from '@/lib/i18n'
import { useStats } from '@/lib/queries'
import { formatNum } from '@/lib/types'
import { ChevronDown } from 'lucide-react'
import { HeroBackground } from './hero-background'
import { HeroCountdown } from './hero-countdown'
import { HeroTrustBadges } from './hero-trust-badges'
import { HeroStat } from './hero-stat'
import { HeroTrustedBy } from './hero-trusted-by'

type Stats = {
  brands: number
  routes: number
  trips: number
  places: number
  campaigns: number
  bookings: number
  revenue: number
  happyCustomers: number
}

export function Hero() {
  const [stats, setStats] = useState<Stats | null>(null)
  const t = useT()

  // Flash Sale countdown
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null)
  const targetRef = useRef<number>(0)

  const computeCountdown = useCallback((target: number) => {
    const now = Date.now()
    const diff = Math.max(0, target - now)
    const hours = Math.floor(diff / 3600000)
    const minutes = Math.floor((diff % 3600000) / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    return { hours, minutes, seconds }
  }, [])

  useEffect(() => {
    // Set target 23h59m from now
    targetRef.current = Date.now() + 23 * 3600000 + 59 * 60000
    setCountdown(computeCountdown(targetRef.current))
    const interval = setInterval(() => {
      const cd = computeCountdown(targetRef.current)
      setCountdown(cd)
      if (cd.hours === 0 && cd.minutes === 0 && cd.seconds === 0) {
        clearInterval(interval)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [computeCountdown])

  const { data: statsData } = useStats()
  useEffect(() => {
    if (statsData) {
      setStats({
        brands: Number(statsData.brands) || 0,
        routes: Number(statsData.routes) || 0,
        trips: Number(statsData.trips) || 0,
        places: 0,
        campaigns: 0,
        bookings: 0,
        revenue: 0,
        happyCustomers: 0,
      })
    }
  }, [statsData])

  return (
    <section className="relative overflow-hidden isolate">
      {/* Background — section is a stacking context (isolate), so bg layers stay behind content but above page bg.
          Natural photography look: clearer image, softer warm-to-neutral overlay instead of heavy blue. */}
      <HeroBackground />

      <div className="relative container mx-auto px-4 pt-12 pb-16 md:pt-20 md:pb-24">
        <div className="max-w-3xl text-white">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur-md px-3.5 py-1.5 text-xs font-semibold ring-1 ring-white/30 mb-5">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            <span className="text-white">Hơn {stats ? formatNum(stats.happyCustomers) : '125.000+'} hành khách tin dùng</span>
          </div>

          <h1 className="text-balance text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05] drop-">
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

        {/* Flash Sale Countdown */}
        <HeroCountdown countdown={countdown} />

        {/* Search widget — z-40 lifts the whole widget (and its autocomplete
            dropdowns) above later siblings like TrustBadges that also create
            their own stacking contexts via backdrop-blur. Without this, the
            PlaceAutocomplete dropdown gets trapped inside the widget's own
            backdrop-blur stacking context and is painted UNDER the trust
            badges that follow in the DOM. */}
        <div className="relative z-40 mt-8 md:mt-10">
          <div className="rounded-3xl p-1.5 md:p-2 bg-white/15 ring-1 ring-white/25 backdrop-blur-md">
            <SearchWidget />
          </div>
        </div>

        {/* Trust badges */}
        <HeroTrustBadges />

        {/* Stats — static display */}
        {stats && (
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4 text-white">
            <HeroStat value={stats.brands} label="Hãng xe" />
            <HeroStat value={stats.routes} label="Tuyến đường" />
            <HeroStat value={stats.trips} label="Chuyến/ngày" />
            <HeroStat value={stats.places} label="Địa điểm" />
          </div>
        )}

        {/* Trusted-by logos strip */}
        <HeroTrustedBy />

        {/* Scroll down indicator */}
        <div className="mt-10 flex justify-center">
          <button
            onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}
            className="flex flex-col items-center gap-1 text-white/70 hover:text-white transition-colors"
            aria-label="Cuộn xuống"
          >
            <span className="text-[11px] font-bold uppercase tracking-widest">Khám phá</span>
            <ChevronDown className="h-5 w-5 animate-bounce" />
          </button>
        </div>
      </div>

      {/* Trust signals bar — SSL + data protection + Decree 13 compliance */}
      <TrustBar className="bg-white/95 dark:bg-slate-900/95 border-t border-border" />
    </section>
  )
}
