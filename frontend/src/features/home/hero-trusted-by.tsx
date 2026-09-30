'use client'

// Extracted from the original 'hero.tsx'.

import { useMemo } from 'react'
import { Bus } from 'lucide-react'
import { useBrands } from '@/lib/queries'
import { useT } from '@/lib/i18n'

/**
 * Trusted-by strip — the REAL brands on the platform (GET /api/brands),
 * with their uploaded logos when available.
 *
 * The previous version hard-coded seven brand names (including operators
 * that don't exist on this platform) — fabricated social proof. This one
 * renders nothing until real brands exist, and shows their logos the
 * moment admins upload them.
 */
export function HeroTrustedBy() {
  const t = useT()
  const { data } = useBrands()
  // The public brands endpoint only returns ACTIVE brands — no extra
  // filtering needed here.
  const brands = useMemo(() => (data?.items ?? []).slice(0, 8), [data])

  if (brands.length === 0) return null

  return (
    <div className="mt-10 pt-6 border-t border-white/15">
      <div className="text-center mb-3">
        <span className="text-[11px] font-bold uppercase tracking-widest text-blue-100">
          {t('home.trustedBy')}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {brands.map((b) => (
          <span
            key={b.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 hover:ring-white/30 transition-colors cursor-default"
          >
            {b.logoUrl ? (
              <img src={b.logoUrl} alt="" className="h-3.5 w-3.5 rounded-full object-contain" loading="lazy" />
            ) : (
              <Bus className="h-3 w-3 text-amber-300" />
            )}
            {b.name}
          </span>
        ))}
      </div>
    </div>
  )
}
