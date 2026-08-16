'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { SearchWidget } from '@/components/home/search-widget'
import { useT } from '@/lib/i18n'
import { formatNum } from '@/lib/types'
import { ShieldCheck, Wallet, Headset, Star, Zap, ChevronDown, Bus, MapPin, Navigation, Route } from 'lucide-react'

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

/* Trusted-by partner logos strip (small brand-style pills) */
const trustedBy = [
  'Phương Trang',
  'Thanh Bình',
  'Hà Thành',
  'Mai Linh',
  'Futa Bus',
  'Limousine Việt',
  'Hoàng Long',
]

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

  useEffect(() => {
    // Backend route: `GET /api/stats` (no params). Send `credentials:
    // 'include'` so the httpOnly JWT cookie is attached.
    fetch('/api/stats', { credentials: 'include' })
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})
  }, [])

  return (
    <section className="relative overflow-hidden isolate">
      {/* Background — section is a stacking context (isolate), so bg layers stay behind content but above page bg.
          Natural photography look: clearer image, softer warm-to-neutral overlay instead of heavy blue. */}
      <div className="absolute inset-0 -z-10 bg-slate-900">
        <picture>
          {/* AVIF — smallest, modern browsers only */}
          <source
            srcSet="/hero-vietnam-bus.avif"
            type="image/avif"
            media="(min-width: 641px)"
          />
          {/* WebP — broad modern-browser support */}
          <source
            srcSet="/hero-vietnam-bus-mobile.webp 640w, /hero-vietnam-bus.webp 1344w"
            sizes="100vw"
            type="image/webp"
          />
          {/* JPEG fallback — legacy browsers */}
          <source
            srcSet="/hero-vietnam-bus-mobile.jpg 640w, /hero-vietnam-bus.jpg 1344w"
            sizes="100vw"
            type="image/jpeg"
          />
          <img
            src="/hero-vietnam-bus.jpg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-70"
            // Hero is above-the-fold — fetch with high priority and decode eagerly.
            fetchPriority="high"
            loading="eager"
            decoding="async"
            width={1344}
            height={768}
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </picture>
        {/* Soft natural gradient — warm sand at top fading to deep neutral at bottom for text legibility */}
        <div className="absolute inset-0 bg-linear-to-b from-slate-900/40 via-slate-900/55 to-slate-900/85" />
        {/* Subtle warm light wash for a natural, less "blue-tinted" feel */}
        <div className="absolute inset-0 bg-linear-to-br from-amber-900/10 via-transparent to-blue-900/10" />
        {/* Decorative dotted pattern — very subtle */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />
        {/* Decorative bus route dashed lines — very subtle */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
          <line x1="5%" y1="30%" x2="95%" y2="30%" stroke="white" strokeWidth="1" strokeDasharray="8 12" />
          <line x1="10%" y1="55%" x2="90%" y2="55%" stroke="white" strokeWidth="1" strokeDasharray="6 10" />
          <line x1="8%" y1="78%" x2="92%" y2="78%" stroke="white" strokeWidth="0.5" strokeDasharray="4 8" />
        </svg>

        {/* Static decorative bus/route icons — subtle, low opacity */}
        <div className="absolute top-[18%] left-[8%] text-white/5">
          <Bus className="h-16 w-16 md:h-24 md:w-24" strokeWidth={1.2} />
        </div>
        <div className="absolute top-[55%] right-[6%] text-white/5">
          <MapPin className="h-14 w-14 md:h-20 md:w-20" strokeWidth={1.2} />
        </div>
        <div className="absolute top-[30%] right-[18%] text-white/5">
          <Navigation className="h-12 w-12 md:h-16 md:w-16" strokeWidth={1.2} />
        </div>
        <div className="absolute bottom-[15%] left-[20%] text-white/5">
          <Route className="h-14 w-14 md:h-20 md:w-20" strokeWidth={1.2} />
        </div>

        {/* Static blurred color blobs — warm + cool balance for natural feel */}
        <div className="absolute top-20 right-[15%] h-40 w-40 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute bottom-10 left-[10%] h-32 w-32 rounded-full bg-blue-400/10 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 h-48 w-48 rounded-full bg-orange-400/[0.07] blur-3xl" />
      </div>

      <div className="relative container mx-auto px-4 pt-12 pb-16 md:pt-20 md:pb-24">
        <div className="max-w-3xl text-white">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur-md px-3.5 py-1.5 text-xs font-semibold ring-1 ring-white/30 mb-5 shadow-lg shadow-blue-950/30">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            <span className="text-white">Hơn {stats ? formatNum(stats.happyCustomers) : '125.000+'} hành khách tin dùng</span>
          </div>

          <h1 className="text-balance text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05] drop-shadow-sm">
            <span className="text-white">{t('hero.title')}</span>
            <br />
            <span className="bg-linear-to-r from-amber-300 via-yellow-200 to-amber-300 bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(252,211,77,0.35)]">
              {t('hero.titleHighlight')}
            </span>
          </h1>
          <p className="mt-5 text-base md:text-lg text-blue-50/95 max-w-2xl leading-relaxed">
            {t('hero.subtitle')}
          </p>
        </div>

        {/* Flash Sale Countdown */}
        {countdown && (countdown.hours > 0 || countdown.minutes > 0 || countdown.seconds > 0) && (
          <div className="mt-6 inline-flex items-center gap-3 rounded-full bg-linear-to-r from-rose-500/25 via-amber-500/20 to-orange-500/25 backdrop-blur-xl ring-1 ring-amber-300/40 px-5 py-2.5 shadow-lg shadow-amber-900/30 relative overflow-hidden">
            {/* shimmer sweep */}
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_3s_ease-in-out_infinite] bg-linear-to-r from-transparent via-white/15 to-transparent pointer-events-none" />
            <span className="relative flex items-center">
              <span className="absolute inline-flex h-3 w-3 rounded-full bg-amber-400/60 animate-ping" />
              <Zap className="relative h-5 w-5 text-amber-300 fill-amber-400/40" />
            </span>
            <span className="relative text-sm font-bold text-amber-50 whitespace-nowrap tracking-wide">
              {t('hero.flashSale')}
            </span>
            <div className="relative flex items-center gap-1 font-mono">
              <CountdownUnit value={countdown.hours} label="h" />
              <span className="text-amber-200 text-lg font-bold">:</span>
              <CountdownUnit value={countdown.minutes} label="m" />
              <span className="text-amber-200 text-lg font-bold">:</span>
              <CountdownUnit value={countdown.seconds} label="s" />
            </div>
          </div>
        )}

        {/* Search widget — z-40 lifts the whole widget (and its autocomplete
            dropdowns) above later siblings like TrustBadges that also create
            their own stacking contexts via backdrop-blur. Without this, the
            PlaceAutocomplete dropdown gets trapped inside the widget's own
            backdrop-blur stacking context and is painted UNDER the trust
            badges that follow in the DOM. */}
        <div className="relative z-40 mt-8 md:mt-10">
          <div className="rounded-3xl p-1.5 md:p-2 bg-white/15 ring-1 ring-white/25 shadow-2xl shadow-blue-950/40 backdrop-blur-md">
            <SearchWidget />
          </div>
        </div>

        {/* Trust badges */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
          <TrustBadge icon={<ShieldCheck className="h-5 w-5" />} title="Thanh toán an toàn" sub="Mã hoá SSL 256-bit" />
          <TrustBadge icon={<Wallet className="h-5 w-5" />} title="Giá tốt nhất" sub="Cam kết hoàn tiền" />
          <TrustBadge icon={<Headset className="h-5 w-5" />} title="Hỗ trợ 24/7" sub="Chat trực tuyến" />
          <TrustBadge icon={<Star className="h-5 w-5" />} title="4.8/5 đánh giá" sub="12.500+ review" />
        </div>

        {/* Stats — static display */}
        {stats && (
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4 text-white">
            <Stat value={stats.brands} label="Hãng xe" />
            <Stat value={stats.routes} label="Tuyến đường" />
            <Stat value={stats.trips} label="Chuyến/ngày" />
            <Stat value={stats.places} label="Địa điểm" />
          </div>
        )}

        {/* Trusted-by logos strip */}
        <div className="mt-10 pt-6 border-t border-white/15">
          <div className="text-center mb-3">
            <span className="text-[11px] font-bold uppercase tracking-widest text-blue-100">
              Được tin dùng bởi các hãng xe hàng đầu
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {trustedBy.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 hover:ring-white/30 transition-colors cursor-default"
              >
                <Bus className="h-3 w-3 text-amber-300" />
                {name}
              </span>
            ))}
          </div>
        </div>

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
    </section>
  )
}

function TrustBadge({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="group relative flex items-center gap-3 rounded-xl bg-white/15 ring-1 ring-white/25 px-3 py-2.5 hover:bg-white/25 hover:ring-white/35 transition-all hover:-translate-y-0.5 backdrop-blur-sm overflow-hidden">
      {/* hover glow sweep */}
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-linear-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
      <div className="relative h-9 w-9 rounded-lg bg-white/20 flex items-center justify-center text-amber-300 ring-1 ring-white/20 shadow-inner shadow-amber-500/10">
        {icon}
      </div>
      <div className="relative leading-tight">
        <div className="text-sm font-bold text-white">{title}</div>
        <div className="text-xs text-blue-50/90 font-medium">{sub}</div>
      </div>
    </div>
  )
}

/* Stat — animated count-up on mount, with a soft glowing background card */
function Stat({ value, label }: { value: number; label: string }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  // Count-up animation triggered when the stat scrolls into view.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !startedRef.current) {
          startedRef.current = true
          const duration = 1400
          const start = performance.now()
          const tick = (now: number) => {
            const p = Math.min(1, (now - start) / duration)
            // ease-out cubic for a natural deceleration
            const eased = 1 - Math.pow(1 - p, 3)
            setDisplay(Math.round(value * eased))
            if (p < 1) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }
      },
      { threshold: 0.4 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [value])

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur-md px-4 py-3 hover:bg-white/15 hover:ring-white/30 transition-all hover:-translate-y-0.5"
    >
      {/* soft glow behind the number */}
      <div
        className="absolute -top-6 left-1/2 -translate-x-1/2 h-16 w-16 rounded-full blur-2xl opacity-50"
        style={{ background: 'radial-gradient(circle, rgba(252,211,77,0.45), transparent 70%)' }}
      />
      <div className="relative text-center md:text-left">
        <div className="text-2xl md:text-3xl font-extrabold text-white tabular-nums drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
          {formatNum(display)}<span className="text-amber-300">+</span>
        </div>
        <div className="text-xs text-blue-100 font-semibold mt-0.5 uppercase tracking-wide">{label}</div>
      </div>
    </div>
  )
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-0.5">
      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-white/25 backdrop-blur-sm text-base font-bold text-white ring-1 ring-white/30 px-1 shadow-sm">
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[10px] font-bold text-amber-100">{label}</span>
    </div>
  )
}
