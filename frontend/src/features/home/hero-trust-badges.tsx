'use client'

// Extracted from the original 'hero.tsx'.

import { ShieldCheck, Wallet, Headset, Star } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function HeroTrustBadges() {
  const t = useT()
  return (
    <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
      <TrustBadge icon={<ShieldCheck className="h-5 w-5" />} title={t('home.trustSecurePayment')} sub={t('home.trustSsl')} />
      <TrustBadge icon={<Wallet className="h-5 w-5" />} title={t('home.trustBestPrice')} sub={t('home.trustMoneyBack')} />
      <TrustBadge icon={<Headset className="h-5 w-5" />} title={t('nav.support247')} sub={t('home.trustChat')} />
      <TrustBadge icon={<Star className="h-5 w-5" />} title={t('home.trustRating')} sub={t('home.trustReviews')} />
    </div>
  )
}

function TrustBadge({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="group relative flex items-center gap-3 rounded-xl bg-white/15 ring-1 ring-white/25 px-3 py-2.5 hover:bg-white/25 hover:ring-white/35 transition-all hover:-translate-y-0.5 backdrop-blur-sm overflow-hidden">
      {/* hover glow sweep */}
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-linear-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
      <div className="relative h-9 w-9 rounded-lg bg-white/20 flex items-center justify-center text-amber-300 ring-1 ring-white/20">
        {icon}
      </div>
      <div className="relative leading-tight">
        <div className="text-sm font-bold text-white">{title}</div>
        <div className="text-xs text-blue-50/90 font-medium">{sub}</div>
      </div>
    </div>
  )
}
