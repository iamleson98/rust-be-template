'use client'

// Extracted from the original 'hero.tsx'.

import { useEffect, useRef, useState } from 'react'
import { formatNum } from '@/lib/format'

/* Stat — the exact backend number, counted up when it scrolls into view */
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
      { threshold: 0.4 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [value])

  return (
    <div
      ref={ref}
      className="rounded-xl bg-white/10 px-2 py-3 text-center ring-1 ring-white/15 backdrop-blur-md sm:px-4 md:text-left"
    >
      <div className="text-2xl font-bold text-white tabular-nums md:text-3xl">
        {formatNum(display)}
      </div>
      <div className="mt-0.5 text-xs leading-tight text-balance text-blue-100">{label}</div>
    </div>
  )
}
