import { memo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { campaignsOptions, type CampaignOut } from '@/api'
import { ErrorState } from '@/components/error-state'
import { CampaignsSkeleton } from '@/features/home/components/campaigns-skeleton'
import { formatDay } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { HomeSection, RAIL } from './section'

/** The discount in a few characters, for the coupon stub. */
function stubLabel(c: CampaignOut, t: ReturnType<typeof useT>) {
  if (c.discountType === 'percent') return `-${c.discountValue}%`
  if (c.discountType === 'fixed_amount')
    return `-${Math.round(c.discountValue / 1000).toLocaleString('vi-VN')}k`
  return t('home.discountDefault')
}

/** Active promo codes as coupons: what it gives, until when, one tap to copy. */
export const CampaignsBanner = memo(function CampaignsBanner() {
  const t = useT()
  const { data, isLoading, isError, refetch } = useQuery(campaignsOptions())
  const items = data?.items ?? []
  const [copied, setCopied] = useState<string | null>(null)

  const describe = (c: CampaignOut) => {
    if (c.discountType === 'percent') return t('home.discountPercent', { value: c.discountValue })
    if (c.discountType === 'fixed_amount')
      return t('home.discountFixed', { value: c.discountValue.toLocaleString('vi-VN') })
    if (c.discountType === 'free_child') return t('home.discountFreeChild')
    if (c.discountType === 'seat_upgrade') return t('home.discountSeatUpgrade')
    return t('home.discountDefault')
  }

  // navigator.clipboard is missing on insecure origins (http:// on a LAN); the code stays visible.
  const copy = (code: string) => {
    try {
      void navigator.clipboard?.writeText(code)
    } catch {
      /* non-fatal */
    }
    setCopied(code)
    toast.success(t('home.campaignCopiedToast'), {
      description: t('home.campaignCopiedToastDesc', { code }),
      duration: 2500,
    })
    setTimeout(() => setCopied(null), 1500)
  }

  if (isLoading) return <CampaignsSkeleton count={3} />
  if (isError)
    return (
      <div className="page-x py-10">
        <ErrorState description={t('home.campaignLoadError')} onRetry={() => refetch()} />
      </div>
    )
  if (items.length === 0) return null

  return (
    <HomeSection title={t('home.campaignsTitle')} subtitle={t('home.campaignsSubtitle')}>
      <div className={cn(RAIL, 'lg:grid-cols-3')}>
        {items.map((c) => (
          <div
            key={c.id}
            className="flex overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-200/80"
          >
            {/* The stub, with a perforated edge. */}
            <div className="relative flex w-24 shrink-0 flex-col items-center justify-center bg-linear-to-br from-rose-500 to-orange-500 px-2 text-white">
              <span className="text-xl leading-none font-extrabold tracking-tight">
                {stubLabel(c, t)}
              </span>
              <span className="absolute inset-y-2 -right-1.5 w-3 bg-[radial-gradient(circle,white_3px,transparent_3.5px)] bg-size-[12px_12px]" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{describe(c)}</div>
                {c.endsAt && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    {t('home.campaignEnds', { date: formatDay(c.endsAt) })}
                  </div>
                )}
              </div>
              <div className="mt-auto flex items-center gap-2">
                <code className="min-w-0 truncate rounded-lg border border-dashed border-rose-300 bg-rose-50 px-2.5 py-1.5 font-mono text-sm font-bold tracking-wider text-rose-600">
                  {c.code}
                </code>
                <button
                  onClick={() => copy(c.code)}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
                >
                  {copied === c.code ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copied === c.code ? t('home.copiedShort') : t('home.copy')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </HomeSection>
  )
})
