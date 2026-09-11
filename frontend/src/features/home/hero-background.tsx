'use client'

// Extracted from the original 'hero.tsx'.

import { Bus, MapPin, Navigation, Route } from 'lucide-react'

export function HeroBackground() {
  return (
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
            ; (e.target as HTMLImageElement).style.display = 'none'
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
  )
}
