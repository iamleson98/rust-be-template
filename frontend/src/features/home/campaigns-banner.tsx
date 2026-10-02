'use client'

import { memo, useEffect, useState } from 'react'
import { useCampaigns, type Campaign } from '@/lib/queries'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/layout/error-state'
import { Tag, Copy, Check, Zap, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { CampaignsSkeleton } from '@/features/home/components/campaigns-skeleton'

/* Countdown timer for campaigns */
function CampaignCountdown({ endTime }: { endTime: number }) {
  const t = useT()
  // Lazy initializer: without the arrow, endTime - Date.now() would be
  // re-evaluated on EVERY render (impure + resets the countdown).
  const [timeLeft, setTimeLeft] = useState(() => endTime - Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(endTime - Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [endTime])

  if (timeLeft <= 0) return <span className="text-[10px] text-muted-foreground">{t('home.campaignExpired')}</span>

  const hours = Math.floor(timeLeft / 3600000)
  const minutes = Math.floor((timeLeft % 3600000) / 60000)
  const seconds = Math.floor((timeLeft % 60000) / 1000)

  return (
    <div className="flex items-center gap-1 text-[11px] font-mono">
      <Timer className="h-3 w-3 text-amber-500" />
      <span className="text-amber-600 font-semibold">
        {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </span>
    </div>
  )
}

export const CampaignsBanner = memo(function CampaignsBanner() {
  const t = useT()
  const { data, isLoading, isError, refetch } = useCampaigns()
  const items: Campaign[] = data?.items ?? []
  const [copied, setCopied] = useState<string | null>(null)

  /* Copy a campaign code — guarded: navigator.clipboard is undefined on
     non-secure contexts (http:// LAN access) and would throw on click. */
  const copy = (code: string) => {
    try {
      navigator.clipboard?.writeText(code)
    } catch {
      /* non-fatal — the code is shown in the card */
    }
    setCopied(code)
    toast.success(t('home.campaignCopiedToast'), {
      description: t('home.campaignCopiedToastDesc', { code }),
      duration: 2500,
    })
    setTimeout(() => setCopied(null), 1500)
  }

  const typeLabel = (kind: string, v: number) => {
    if (kind === 'percent') return t('home.discountPercent', { value: v })
    if (kind === 'fixed_amount') return t('home.discountFixed', { value: v.toLocaleString('vi-VN') })
    if (kind === 'free_child') return t('home.discountFreeChild')
    if (kind === 'seat_upgrade') return t('home.discountSeatUpgrade')
    return t('home.discountDefault')
  }

  return (
    <section className="bg-linear-to-br from-amber-50 via-orange-50 to-rose-50 border-y border-amber-100/80">
      <div className="container mx-auto px-4 py-12">
        {isLoading ? (
          <CampaignsSkeleton count={3} />
        ) : isError ? (
          <ErrorState
            description={t('home.campaignLoadError')}
            onRetry={() => refetch()}
          />
        ) : items.length === 0 ? null : (
          <>
            <div className="flex items-end justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Tag className="h-5 w-5 text-rose-500" />
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">{t('home.campaignsTitle')}</h2>
                </div>
                <p className="text-muted-foreground text-sm">{t('home.campaignsSubtitle')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((c) => {
                // `CampaignOut` only exposes `code`, `discountType`,
                // `discountValue`, `endsAt`, `id`. We use a fixed rose banner color
                // since the API no longer returns one.
                const bannerColor = '#f43f5e'
                // Real server-provided expiry (ISO string) — campaigns without
                // an end date simply don't render a countdown.
                const endsAtMs = c.endsAt ? Date.parse(c.endsAt) : NaN
                return (
                  <Card key={c.id} className="relative overflow-hidden border-0 h-full">
                      {/* Shimmer sweep overlay */}
                      <div className="absolute inset-0 -translate-x-full hover:translate-x-full transition-transform duration-1500 bg-linear-to-r from-transparent via-white/40 to-transparent skew-x-12 pointer-events-none z-10" />

                      {/* Gradient overlay on the card top */}
                      <div
                        className="absolute inset-x-0 top-0 h-20 opacity-10 hover:opacity-20 transition-opacity"
                        style={{ background: `linear-gradient(180deg, ${bannerColor}, transparent)` }}
                      />
                      {/* Banner stripe */}
                      <div className="absolute left-0 top-0 bottom-0 w-1.5 transition-all hover:w-2 duration-300" style={{ background: bannerColor }} />

                      {/* Decorative circles */}
                      <div
                        className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-10 hover:opacity-20 transition-opacity"
                        style={{ background: bannerColor }}
                      />

                      {/* "Hot" badge removed — a fabricated "every 3rd card is
                          featured" rule presented invented urgency. */}

                      <div className="p-5 pl-6 relative">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Badge
                              className="mb-2 text-[11px] font-bold"
                              style={{ background: `${bannerColor}20`, color: bannerColor }}
                            >
                              <Zap className="h-3 w-3 mr-0.5" />
                              {typeLabel(c.discountType, c.discountValue)}
                            </Badge>
                            <h3 className="font-bold text-base leading-snug">{c.code}</h3>
                          </div>
                          {/* Countdown timer — only when the server provided an end date */}
                          {Number.isFinite(endsAtMs) && <CampaignCountdown endTime={endsAtMs} />}
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <code
                              className="rounded-md px-2.5 py-1.5 text-sm font-mono font-bold tracking-wider border-2 border-dashed"
                              style={{ borderColor: `${bannerColor}50`, color: bannerColor }}
                            >
                              {c.code}
                            </code>
                          </div>
                          <button
                            onClick={() => copy(c.code)}
                            className="inline-flex items-center gap-1 rounded-lg px-3.5 py-2 text-xs font-bold text-white transition-all"
                            style={{ background: bannerColor }}
                          >
                            {copied === c.code ? (
                              <>
                                <Check className="h-3.5 w-3.5" /> {t('home.copiedShort')}
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" /> {t('home.copy')}
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </Card>
                  )
              })}
            </div>
          </>
        )}
      </div>
    </section>
  )
})
