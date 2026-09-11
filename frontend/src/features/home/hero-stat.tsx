'use client'

// Extracted from the original 'hero.tsx'.

import { useEffect, useRef, useState } from 'react'
import { formatNum } from '@/lib/types'

/* Stat — animated count-up on mount, with a soft glowing background card */
export function HeroStat({ value, label }: { value: number; label: string }) {
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
        <div className="text-2xl md:text-3xl font-extrabold text-white tabular-nums">
          {formatNum(display)}<span className="text-amber-300">+</span>
        </div>
        <div className="text-xs text-blue-100 font-semibold mt-0.5 uppercase tracking-wide">{label}</div>
      </div>
    </div>
  )
}
