'use client'

// Extracted from the original 'hero.tsx'.

import { useT } from '@/lib/i18n'
import { Zap } from 'lucide-react'

export function HeroCountdown({
  countdown,
}: {
  countdown: { hours: number; minutes: number; seconds: number } | null
}) {
  const t = useT()

  return (
    countdown &&
    (countdown.hours > 0 || countdown.minutes > 0 || countdown.seconds > 0) && (
      <div className="mt-6 inline-flex items-center gap-3 rounded-full bg-linear-to-r from-rose-500/25 via-amber-500/20 to-orange-500/25 backdrop-blur-xl ring-1 ring-amber-300/40 px-5 py-2.5 relative overflow-hidden">
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
    )
  )
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-0.5">
      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-white/25 backdrop-blur-sm text-base font-bold text-white ring-1 ring-white/30 px-1">
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[10px] font-bold text-amber-100">{label}</span>
    </div>
  )
}
