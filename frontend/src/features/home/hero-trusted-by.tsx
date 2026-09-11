'use client'

// Extracted from the original 'hero.tsx'.

import { Bus } from 'lucide-react'

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

export function HeroTrustedBy() {
  return (
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
  )
}
