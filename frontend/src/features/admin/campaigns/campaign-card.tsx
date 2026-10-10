import { Pause, Pencil, Play, Trash2 } from 'lucide-react'
import type { AdminCampaignOut } from '@/api'
import { Button } from '@/components/ui/button'
import { operatorsText, validityText } from '@/features/campaigns/labels'
import { formatDayTime, formatNum, useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const STATE_TONE: Record<string, string> = {
  running:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  upcoming:
    'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  paused:
    'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  ended: 'bg-muted text-muted-foreground ring-border',
}

/**
 * One campaign: its state, window and scope, each tier with how much of it
 * was claimed, and where the money stands (budget, in use, owed, paid).
 */
export function CampaignCard({
  campaign: c,
  busy,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  campaign: AdminCampaignOut
  busy: boolean
  onEdit: () => void
  onTogglePause: () => void
  onDelete: () => void
}) {
  const t = useT()
  const money = useMoney()
  const claimedAny = c.tiers.some((tier) => tier.claimedSlots > 0)
  const ended = c.state === 'ended'

  const figures = [
    { label: t('adminCampaigns.claimed'), value: formatNum(c.totals.claimed) },
    { label: t('adminCampaigns.inUse'), value: formatNum(c.totals.inUse) },
    {
      label: t('adminCampaigns.owed'),
      value: money(c.totals.owedAmount),
      tone: c.totals.owedAmount > 0 ? 'text-amber-700 dark:text-amber-300' : undefined,
    },
    { label: t('adminCampaigns.paid'), value: money(c.totals.paidAmount) },
  ]

  return (
    <article className="flex flex-col rounded-2xl bg-card text-card-foreground shadow-soft ring-1 ring-slate-200/80 dark:ring-white/10">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
                STATE_TONE[c.state] ?? STATE_TONE.ended,
              )}
            >
              {t(`adminCampaigns.state.${c.state}`)}
            </span>
            <h3 className="min-w-0 truncate text-base font-semibold">{c.name}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {formatDayTime(c.startsAt)} → {formatDayTime(c.endsAt)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {operatorsText(c, t)} ·{' '}
            {c.couponValidity === 'permanent'
              ? t('adminCampaigns.validityPermanent')
              : validityText(c.endsAt, t)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            aria-label={t('adminCampaigns.edit')}
          >
            <Pencil />
          </Button>
          {!ended && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onTogglePause}
              disabled={busy}
              aria-label={c.paused ? t('adminCampaigns.resume') : t('adminCampaigns.pause')}
              title={c.paused ? t('adminCampaigns.resume') : t('adminCampaigns.pause')}
            >
              {c.paused ? <Play /> : <Pause />}
            </Button>
          )}
          {!claimedAny && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
              onClick={onDelete}
              aria-label={t('common.delete')}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      <ul className="space-y-2 border-t px-4 py-3">
        {c.tiers.map((tier) => {
          const pct =
            tier.totalSlots > 0 ? Math.round((tier.claimedSlots / tier.totalSlots) * 100) : 0
          return (
            <li key={tier.id} className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0 font-semibold tabular-nums">{money(tier.amount)}</span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-rose-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {formatNum(tier.claimedSlots)}/{formatNum(tier.totalSlots)}
              </span>
            </li>
          )
        })}
        <li className="flex justify-between pt-1 text-xs text-muted-foreground">
          <span>{t('adminCampaigns.budget')}</span>
          <span className="font-semibold text-foreground tabular-nums">
            {money(c.totals.budget)}
          </span>
        </li>
      </ul>

      <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-2 border-t px-4 py-3 sm:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="truncate text-[11px] text-muted-foreground">{f.label}</dt>
            <dd className={cn('truncate text-sm font-semibold tabular-nums', f.tone)}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}
