import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  CircleCheck,
  Loader2,
  Network,
  Phone,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  adminCouponsListOptions,
  adminCouponsPayoutsOptions,
  adminCouponsRejectMutation,
  adminCouponsSettleMutation,
  type AdminCouponOut,
} from '@/api'
import { EmptyState, Panel } from '@/components/console/panel'
import { Segmented } from '@/components/console/segmented'
import { StatGrid, StatTile } from '@/components/console/stat-tile'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/lib/error-message'
import { formatDayTime, formatNum, useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const PAGE = 50
const STATUSES = ['redeemed', 'reserved', 'held', 'settled', 'rejected'] as const
type Status = (typeof STATUSES)[number]

/**
 * Paying operators for coupons used on trips that were made: what is owed per
 * operator, then the coupons themselves with the signs of abuse to check
 * before paying (one phone or network behind many coupons, a brand-new
 * account). Paid and refused coupons are final.
 */
export function PayoutsPanel() {
  const t = useT()
  const money = useMoney()
  const [status, setStatus] = useState<Status>('redeemed')
  const [brand, setBrand] = useState<{ id: string; name: string } | null>(null)
  const [page, setPage] = useState(0)
  const [picked, setPicked] = useState<string[]>([])
  const [settling, setSettling] = useState(false)
  const [rejecting, setRejecting] = useState<AdminCouponOut | null>(null)

  const payouts = useQuery(adminCouponsPayoutsOptions())
  const coupons = useQuery({
    ...adminCouponsListOptions({
      query: { status, brandId: brand?.id, limit: PAGE, offset: page * PAGE },
    }),
    placeholderData: keepPreviousData,
  })
  const items = coupons.data?.items ?? []
  const total = coupons.data?.total ?? 0
  const payable = status === 'redeemed'
  const pickedItems = items.filter((c) => picked.includes(c.id))
  const pickedAmount = pickedItems.reduce((sum, c) => sum + c.amount, 0)

  const filter = (next: { status?: Status; brand?: typeof brand }) => {
    if (next.status) setStatus(next.status)
    if (next.brand !== undefined) setBrand(next.brand)
    setPage(0)
    setPicked([])
  }
  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const allPicked = items.length > 0 && items.every((c) => picked.includes(c.id))

  return (
    <div className="space-y-5">
      <StatGrid>
        <StatTile
          label={t('adminCampaigns.owed')}
          value={payouts.data ? money(payouts.data.totalOwed) : '—'}
          icon={<Wallet />}
          tone="amber"
        />
        <StatTile
          label={t('adminCampaigns.paid')}
          value={payouts.data ? money(payouts.data.totalPaid) : '—'}
          icon={<CircleCheck />}
          tone="green"
        />
      </StatGrid>

      <Panel title={t('adminCampaigns.payoutsTitle')} icon={<Wallet />}>
        {payouts.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !payouts.data?.items.length ? (
          <EmptyState icon={<Wallet />} text={t('adminCampaigns.payoutsEmpty')} />
        ) : (
          <ul className="divide-y divide-border/60">
            {payouts.data.items.map((p) => {
              const name = p.brand?.name ?? t('adminCampaigns.unknownOperator')
              const active = !!p.brand && brand?.id === p.brand.id
              return (
                <li key={p.brand?.id ?? 'none'}>
                  <button
                    type="button"
                    disabled={!p.brand}
                    onClick={() =>
                      p.brand &&
                      filter({
                        status: 'redeemed',
                        brand: active ? null : { id: p.brand.id, name },
                      })
                    }
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:hover:bg-transparent',
                      active && 'bg-primary/5',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                    <span className="shrink-0 text-right text-xs tabular-nums">
                      <span
                        className={cn(
                          'block font-semibold',
                          p.owedAmount > 0
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-muted-foreground',
                        )}
                      >
                        {p.owedCount > 0
                          ? t('adminCampaigns.totalOwed', {
                              amount: money(p.owedAmount),
                              count: formatNum(p.owedCount),
                            })
                          : t('adminCampaigns.nothingOwed')}
                      </span>
                      <span className="block text-muted-foreground">
                        {t('adminCampaigns.totalPaid', { amount: money(p.paidAmount) })}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Panel title={t('adminCampaigns.reviewTitle')} icon={<AlertTriangle />}>
        <p className="mb-3 text-xs text-muted-foreground">{t('adminCampaigns.reviewHint')}</p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="max-w-full overflow-x-auto scrollbar-none">
            <Segmented
              label={t('common.status')}
              value={status}
              onChange={(s) => filter({ status: s })}
              options={STATUSES.map((s) => ({ value: s, label: t(`adminCampaigns.status.${s}`) }))}
            />
          </div>
          {brand && (
            <button
              type="button"
              onClick={() => filter({ brand: null })}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              {brand.name}
              <X className="size-3.5" aria-label={t('adminCampaigns.clearOperator')} />
            </button>
          )}
        </div>

        {coupons.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<CircleCheck />} text={t('adminCampaigns.reviewEmpty')} />
        ) : (
          <>
            {payable && (
              <button
                type="button"
                role="checkbox"
                aria-checked={allPicked}
                onClick={() => setPicked(allPicked ? [] : items.map((c) => c.id))}
                className="mb-1 flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground"
              >
                <Tick on={allPicked} />
                {t('adminCampaigns.pickAll')}
              </button>
            )}
            <ul className="divide-y divide-border/60">
              {items.map((c) => (
                <CouponRow
                  key={c.id}
                  coupon={c}
                  payable={payable}
                  picked={picked.includes(c.id)}
                  onPick={() => togglePick(c.id)}
                  onReject={() => setRejecting(c)}
                />
              ))}
            </ul>
            {payable && picked.length > 0 && (
              // Sticks above the floating call and support buttons, so a long list never hides it.
              <div className="sticky bottom-24 z-10 mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-white shadow-lg dark:bg-slate-800">
                <span className="text-sm font-medium tabular-nums">
                  {t('adminCampaigns.pickedSummary', {
                    count: formatNum(picked.length),
                    amount: money(pickedAmount),
                  })}
                </span>
                <Button size="sm" variant="secondary" onClick={() => setSettling(true)}>
                  <Check />
                  {t('adminCampaigns.settleConfirm')}
                </Button>
              </div>
            )}
            {total > PAGE && (
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {formatNum(page * PAGE + 1)}–{formatNum(Math.min(total, (page + 1) * PAGE))} /{' '}
                  {formatNum(total)}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    {t('common.prevPage')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * PAGE >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    {t('common.nextPage')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      <SettleDialog
        open={settling}
        ids={picked}
        amount={pickedAmount}
        onClose={(done) => {
          setSettling(false)
          if (done) setPicked([])
        }}
      />
      <RejectDialog
        coupon={rejecting}
        onClose={(done) => {
          if (done && rejecting) setPicked((p) => p.filter((x) => x !== rejecting.id))
          setRejecting(null)
        }}
      />
    </div>
  )
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded border',
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300 bg-background',
      )}
    >
      {on && <Check className="size-3" />}
    </span>
  )
}

/** One coupon: who claimed it, where it was used, the warning signs, and the decision. */
function CouponRow({
  coupon: c,
  payable,
  picked,
  onPick,
  onReject,
}: {
  coupon: AdminCouponOut
  payable: boolean
  picked: boolean
  onPick: () => void
  onReject: () => void
}) {
  const t = useT()
  const money = useMoney()
  const signs = [
    c.sharedPhone > 0 && {
      icon: Phone,
      text: t('adminCampaigns.flagSharedPhone', { count: c.sharedPhone }),
      tone: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
    },
    c.sharedIp > 0 && {
      icon: Network,
      text: t('adminCampaigns.flagSharedIp', { count: c.sharedIp }),
      tone: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
    },
    c.newAccount && {
      icon: UserPlus,
      text: t('adminCampaigns.flagNewAccount'),
      tone: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
    },
  ].filter((s) => !!s)

  return (
    <li className={cn('flex items-start gap-3 px-2 py-3', picked && 'bg-primary/5')}>
      {payable && (
        <button
          type="button"
          role="checkbox"
          aria-checked={picked}
          aria-label={c.code}
          onClick={onPick}
          className="mt-0.5"
        >
          <Tick on={picked} />
        </button>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <code className="font-mono text-xs font-bold tracking-wide">{c.code}</code>
          <span className="text-sm font-semibold tabular-nums">{money(c.amount)}</span>
          <span className="truncate text-xs text-muted-foreground">{c.campaignName}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {c.owner ? `${c.owner.name} · ${c.owner.email}` : '—'}
          {c.booking && (
            <>
              {' · '}
              {t('adminCampaigns.colBooking')}{' '}
              <span className="font-mono font-semibold text-foreground">{c.booking.code}</span>
            </>
          )}
          {c.brand && ` · ${c.brand.name}`}
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {c.settledAt
            ? `${t('adminCampaigns.status.' + c.status)} ${formatDayTime(c.settledAt)}${c.settlementNote ? ` · ${c.settlementNote}` : ''}`
            : c.redeemedAt
              ? `${t('adminCampaigns.tripDone')} ${formatDayTime(c.redeemedAt)}`
              : `${t('adminCampaigns.claimedAt')} ${formatDayTime(c.claimedAt)}`}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {signs.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
              <CircleCheck className="size-3" aria-hidden />
              {t('adminCampaigns.noFlags')}
            </span>
          ) : (
            signs.map((s) => (
              <span
                key={s.text}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
                  s.tone,
                )}
              >
                <s.icon className="size-3" aria-hidden />
                {s.text}
              </span>
            ))
          )}
        </div>
      </div>
      {payable && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          onClick={onReject}
        >
          {t('adminCampaigns.reject')}
        </Button>
      )}
    </li>
  )
}

function SettleDialog({
  open,
  ids,
  amount,
  onClose,
}: {
  open: boolean
  ids: string[]
  amount: number
  onClose: (done: boolean) => void
}) {
  const t = useT()
  const money = useMoney()
  const [note, setNote] = useState('')
  const settle = useMutation(adminCouponsSettleMutation())
  const confirm = () =>
    settle.mutate(
      { body: { couponIds: ids, note: note.trim() || null } },
      {
        onSuccess: (r) => {
          toast.success(t('adminCampaigns.settled', { count: r.settled }))
          setNote('')
          onClose(true)
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !settle.isPending && onClose(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('adminCampaigns.settleTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('adminCampaigns.settleDesc', { count: ids.length, amount: money(amount) })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('adminCampaigns.settleNote')}
          aria-label={t('adminCampaigns.settleNote')}
          maxLength={500}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={settle.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={settle.isPending}
            onClick={(e) => {
              e.preventDefault()
              confirm()
            }}
          >
            {settle.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              t('adminCampaigns.settleConfirm')
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function RejectDialog({
  coupon,
  onClose,
}: {
  coupon: AdminCouponOut | null
  onClose: (done: boolean) => void
}) {
  const t = useT()
  const money = useMoney()
  const [reason, setReason] = useState('')
  const reject = useMutation(adminCouponsRejectMutation())
  const confirm = () => {
    if (!coupon) return
    reject.mutate(
      { path: { id: coupon.id }, body: { reason: reason.trim() } },
      {
        onSuccess: () => {
          toast.success(t('adminCampaigns.rejected'))
          setReason('')
          onClose(true)
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )
  }
  return (
    <AlertDialog open={!!coupon} onOpenChange={(o) => !o && !reject.isPending && onClose(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('adminCampaigns.rejectTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {coupon && `${coupon.code} · ${money(coupon.amount)}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('adminCampaigns.rejectReason')}
          aria-label={t('adminCampaigns.rejectReason')}
          rows={3}
          maxLength={500}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={reject.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={reject.isPending || reason.trim().length < 3}
            className="bg-rose-600 hover:bg-rose-700"
            onClick={(e) => {
              e.preventDefault()
              confirm()
            }}
          >
            {reject.isPending ? <Loader2 className="animate-spin" /> : t('adminCampaigns.reject')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
