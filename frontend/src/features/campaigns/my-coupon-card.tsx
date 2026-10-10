import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Loader2, TicketPercent } from 'lucide-react'
import { toast } from 'sonner'
import { couponsGiveUpMutation, type CouponOut } from '@/api'
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
import { getErrorMessage } from '@/lib/error-message'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { operatorsText, validityText } from './labels'

/**
 * The coupon this customer holds: how much it takes off, until when, for
 * which operators, and the way to use it (book) or drop it (to claim from
 * another campaign). A coupon already on a booking only says which one.
 */
export function MyCouponCard({ coupon, className }: { coupon: CouponOut; className?: string }) {
  const t = useT()
  const money = useMoney()
  const [confirming, setConfirming] = useState(false)
  const giveUp = useMutation(couponsGiveUpMutation())
  const onBooking = coupon.status === 'reserved'

  const confirmGiveUp = () =>
    giveUp.mutate(
      {},
      {
        onSuccess: () => {
          setConfirming(false)
          toast.success(t('campaigns.gaveUpToast'))
        },
        onError: (e) => toast.error(getErrorMessage(e, t('campaigns.err.tryAgain'))),
      },
    )

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-2xl bg-white p-4 text-slate-900 shadow-soft ring-1 ring-rose-200/70 sm:flex-row sm:items-center sm:p-5',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-rose-500 to-orange-400 text-white shadow-sm">
          <TicketPercent className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold tracking-wide text-rose-600 uppercase">
            {t('campaigns.yourCoupon')} · {coupon.campaignName}
          </p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">
              {t('campaigns.off', { amount: money(coupon.amount) })}
            </span>
            <code className="rounded-md border border-dashed border-rose-300 bg-rose-50 px-2 py-0.5 font-mono text-xs font-bold tracking-wider text-rose-700">
              {coupon.code}
            </code>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {validityText(coupon.validUntil, t)} · {operatorsText(coupon, t)}
          </p>
          {onBooking && coupon.bookingCode && (
            <p className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
              {t('campaigns.onBooking', { code: coupon.bookingCode })}
            </p>
          )}
        </div>
      </div>

      {!onBooking && (
        <div className="flex shrink-0 gap-2 max-sm:[&>*]:flex-1">
          <Button variant="outline" onClick={() => setConfirming(true)}>
            {t('campaigns.giveUp')}
          </Button>
          <Button asChild className="bg-rose-600 hover:bg-rose-700">
            <Link to="/search">
              {t('campaigns.bookNow')}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!giveUp.isPending) setConfirming(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('campaigns.giveUpTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('campaigns.giveUpDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={giveUp.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={giveUp.isPending}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                confirmGiveUp()
              }}
            >
              {giveUp.isPending ? <Loader2 className="animate-spin" /> : t('campaigns.giveUp')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
