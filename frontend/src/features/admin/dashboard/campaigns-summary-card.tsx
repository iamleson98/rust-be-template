/**
 * CampaignsSummaryCard — "Chương trình giảm giá đang chạy" (dashboard row 2):
 * each running campaign with how many coupons were claimed and, for admins,
 * what is owed to operators for trips already made. Employees see the public
 * list (they cannot manage campaigns), so the owed column is admin-only.
 */

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { TicketPercent } from 'lucide-react'
import { adminCampaignsListOptions } from '@/api'
import { CountPill, EmptyState, Panel } from '@/components/console/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useCampaigns } from '@/features/campaigns/api'
import { formatDay, useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { isAdminUser, useSession } from '@/stores/session'

const SHOWN = 6

type Row = {
  id: string
  name: string
  endsAt: string
  claimed: number
  total: number
  /** Admins only. */
  owed?: number
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** Running campaigns for the signed-in staff member, from the source they may read. */
function useRunningCampaigns(admin: boolean): { rows: Row[]; loading: boolean } {
  const managed = useQuery({ ...adminCampaignsListOptions(), enabled: admin })
  const visible = useCampaigns()
  if (admin) {
    const rows = (managed.data?.items ?? [])
      .filter((c) => c.state === 'running')
      .map((c) => ({
        id: c.id,
        name: c.name,
        endsAt: c.endsAt,
        claimed: c.totals.claimed,
        total: sum(c.tiers.map((tier) => tier.totalSlots)),
        owed: c.totals.owedAmount,
      }))
    return { rows, loading: managed.isLoading }
  }
  const now = visible.data ? Date.parse(visible.data.serverTime) : 0
  const rows = (visible.data?.items ?? [])
    .filter((c) => Date.parse(c.startsAt) <= now)
    .map((c) => ({
      id: c.id,
      name: c.name,
      endsAt: c.endsAt,
      claimed: sum(c.tiers.map((tier) => tier.totalSlots - tier.remaining)),
      total: sum(c.tiers.map((tier) => tier.totalSlots)),
    }))
  return { rows, loading: visible.isLoading }
}

export function CampaignsSummaryCard() {
  const t = useT()
  const money = useMoney()
  const admin = isAdminUser(useSession((s) => s.user))
  const { rows, loading } = useRunningCampaigns(admin)

  return (
    <Panel
      className="h-full"
      icon={<TicketPercent />}
      title={t('adminDash.campaignsTitle')}
      action={
        <>
          {rows.length > 0 && <CountPill n={rows.length} />}
          {admin && (
            <Link
              to="/admin/campaigns"
              className="text-xs font-medium text-primary hover:underline"
            >
              {t('adminDash.campaignsManage')}
            </Link>
          )}
        </>
      }
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<TicketPercent />} text={t('adminDash.campaignsEmpty')} />
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.slice(0, SHOWN).map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600">
                <TicketPercent className="size-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{c.name}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {t('adminDash.campaignClaimed', { claimed: c.claimed, total: c.total })} ·{' '}
                  {t('adminDash.campaignEnds', { date: formatDay(c.endsAt) })}
                </div>
              </div>
              {c.owed !== undefined && c.owed > 0 && (
                <span className="shrink-0 text-xs font-semibold text-amber-700 tabular-nums dark:text-amber-300">
                  {t('adminDash.campaignsOwed', { amount: money(c.owed) })}
                </span>
              )}
            </li>
          ))}
          {rows.length > SHOWN && (
            <li className="pt-2 text-center text-xs text-muted-foreground">
              {t('adminDash.campaignMore', { count: rows.length - SHOWN })}
            </li>
          )}
        </ul>
      )}
    </Panel>
  )
}
