'use client'

/**
 * CampaignsSummaryCard — "Khuyến mãi đang chạy" (dashboard row 2):
 * a compact list of the campaigns currently returned by
 * `GET /api/campaigns` (`useCampaigns`).
 *
 * Only fields the backend actually ships are rendered: code,
 * discountType (percent / fixed), discountValue and endsAt. The old
 * campaigns table showed name / usedCount / usageLimit / status
 * columns that the API never returns — those invented columns are
 * gone.
 */

import { Sparkles, Percent, Tag } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/lib/i18n'
import { useCampaigns } from '@/lib/queries'
import type { CampaignOut } from '@/lib/api/types.gen'

function formatDiscount(c: CampaignOut): string {
  if (c.discountType === 'percent') return `-${c.discountValue}%`
  // Fixed-amount discounts are VND — shorten 150000 → 150k
  if (c.discountValue >= 1000) return `-${Math.round(c.discountValue / 1000)}k`
  return `-${c.discountValue}`
}

function formatExpiry(
  endsAt: string | null | undefined,
  t: ReturnType<typeof useT>,
): string | null {
  if (!endsAt) return null
  const d = new Date(endsAt)
  if (Number.isNaN(d.getTime())) return null
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return t('adminDash.campaignEnded')
  if (days === 0) return t('adminDash.campaignEndsToday')
  return t('adminDash.campaignDaysLeft', { count: days })
}

export function CampaignsSummaryCard() {
  const t = useT()
  const { data, isLoading } = useCampaigns()
  const campaigns = data?.items ?? []

  return (
    <Card className="overflow-hidden h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          {t('adminDash.campaignsTitle')}
          {campaigns.length > 0 && (
            <Badge variant="secondary" className="ml-auto tabular-nums">
              {campaigns.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <Tag className="h-5 w-5" aria-hidden />
            <p className="text-xs">{t('adminDash.noCampaignsDesc')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {campaigns.slice(0, 6).map((c) => {
              const expiry = formatExpiry(c.endsAt, t)
              return (
                <li key={c.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                    <Percent className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <code className="font-mono text-sm font-bold text-blue-700 dark:text-blue-400">
                      {c.code}
                    </code>
                    <div className="text-xs text-muted-foreground">
                      {expiry ?? t('adminDash.campaignNoExpiry')}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-600">
                    {formatDiscount(c)}
                  </span>
                </li>
              )
            })}
            {campaigns.length > 6 && (
              <li className="pt-2 text-center text-xs text-muted-foreground">
                {t('adminDash.campaignMore', { count: campaigns.length - 6 })}
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
