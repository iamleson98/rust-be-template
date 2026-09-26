'use client'

import { memo, type ReactNode } from 'react'
import { ShieldCheck, Headset, Wallet, Clock, Bus, BadgePercent } from 'lucide-react'
import { useT } from '@/lib/i18n'

const features = [
  {
    icon: <Wallet className="h-6 w-6" />,
    titleKey: 'home.trustBestPrice',
    descKey: 'home.featureBestPriceDesc',
    color: '#2563eb',
  },
  {
    icon: <ShieldCheck className="h-6 w-6" />,
    titleKey: 'home.trustSecurePayment',
    descKey: 'home.featureSecurePaymentDesc',
    color: '#7c3aed',
  },
  {
    icon: <Bus className="h-6 w-6" />,
    titleKey: 'home.featureSeatMap',
    descKey: 'home.featureSeatMapDesc',
    color: '#e11d48',
  },
  {
    icon: <Headset className="h-6 w-6" />,
    titleKey: 'nav.support247',
    descKey: 'home.featureSupportDesc',
    color: '#1d4ed8',
  },
  {
    icon: <Clock className="h-6 w-6" />,
    titleKey: 'home.featureEasyChanges',
    descKey: 'home.featureEasyChangesDesc',
    color: '#d97706',
  },
  {
    icon: <BadgePercent className="h-6 w-6" />,
    titleKey: 'home.featureDailyDeals',
    descKey: 'home.featureDailyDealsDesc',
    color: '#16a34a',
  },
]

const steps = [
  { step: '01', titleKey: 'nav.searchTrips', descKey: 'home.stepFindDesc', icon: '🔍' },
  { step: '02', titleKey: 'home.stepChooseSeat', descKey: 'home.stepChooseSeatDesc', icon: '💺' },
  { step: '03', titleKey: 'home.stepPayment', descKey: 'home.stepPaymentDesc', icon: '💳' },
  { step: '04', titleKey: 'home.stepGetTicket', descKey: 'home.stepGetTicketDesc', icon: '📱' },
]

function FeaturesImpl() {
  const t = useT()
  return (
    <section className="bg-slate-50">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 mb-3">
            {t('home.whyChooseUs')}
          </div>
          <h2 className="text-balance text-3xl md:text-4xl font-extrabold tracking-tight">
            {t('home.featuresTitle')}
          </h2>
          <p className="text-muted-foreground mt-3">
            {t('home.featuresSubtitle')}
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <FeatureCard key={i} feature={f} index={i} />
          ))}
        </div>

        {/* Process strip — "How it works" with numbered gradient circles */}
        <div className="mt-14 rounded-2xl bg-linear-to-r from-blue-900 to-blue-900 p-8 md:p-10 text-white overflow-hidden relative">
          {/* Decorative circles */}
          <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-blue-500/10 blur-2xl" />
          <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-blue-500/10 blur-2xl" />

          {/* Section label */}
          <div className="text-center mb-8 relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-blue-200 backdrop-blur-sm">
              {t('home.howItWorksBadge')}
            </div>
            <h3 className="text-2xl md:text-3xl font-extrabold mt-2">{t('home.fourStepsTitle')}</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative">
            {steps.map((s, i) => (
              <div key={s.step} className="relative text-center md:text-left">
                {/* Numbered circle with gradient background */}
                <div className="relative mx-auto md:mx-0 h-14 w-14 rounded-full bg-linear-to-br from-blue-400 to-blue-500 flex items-center justify-center mb-3">
                  <span className="text-lg font-extrabold text-white">{s.step}</span>
                  {/* Glow ring */}
                  <div className="absolute inset-0 rounded-full ring-2 ring-blue-400/30" />
                </div>
                <div className="text-2xl mb-1">{s.icon}</div>
                <h4 className="font-bold text-lg">{t(s.titleKey)}</h4>
                <p className="text-sm text-blue-100/80">{t(s.descKey)}</p>
                {/* Connecting dotted line between steps on desktop */}
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute -right-3 top-7 w-6 border-t-2 border-dashed border-blue-400/30" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export const Features = memo(FeaturesImpl)

type Feature = {
  icon: ReactNode
  titleKey: string
  descKey: string
  color: string
}

const FeatureCard = memo(function FeatureCard({ feature, index }: { feature: Feature; index: number }) {
  const t = useT()
  const f = feature

  return (
    <div>
      <div
        className="group relative rounded-2xl bg-white p-[1.5px] transition-colors duration-300"
        style={{
          background: `linear-gradient(135deg, oklch(0.92 0 0), oklch(0.96 0 0))`,
        }}
      >
        <div
          className="relative rounded-2xl bg-white p-6 overflow-hidden h-full duration-300"
        >
          {/* Subtle gradient overlay on hover */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-[0.06] transition-opacity duration-300"
            style={{ background: f.color }}
          />

          <div
            className="relative h-14 w-14 rounded-2xl flex items-center justify-center mb-4 transition-colors duration-300"
            style={{ background: `${f.color}15`, color: f.color }}
          >
            {f.icon}
          </div>
          <h3 className="relative font-bold text-lg mb-1.5 transition-colors group-hover:text-blue-700 duration-300">{t(f.titleKey)}</h3>
          <p className="relative text-sm text-muted-foreground leading-relaxed">{t(f.descKey)}</p>

          {/* Connecting dotted line to next card (on desktop, right side) */}
          {(index + 1) % 3 !== 0 && index < features.length - 1 && (
            <div className="hidden lg:block absolute -right-2.5 top-1/2 w-5 border-t-2 border-dashed border-slate-200" />
          )}
        </div>
      </div>
    </div>
  )
})
