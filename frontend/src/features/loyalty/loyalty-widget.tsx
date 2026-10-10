/**
 * The loyalty panel the header's gift button opens: the backend summary
 * (`GET /api/loyalty`, 1 point per 10,000 VND of completed bookings) —
 * points, tier, benefits and the earning history. Signed-out visitors
 * get a way to sign in (the summary is auth-guarded).
 */

import { memo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bus, Gift, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/lib/i18n'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { useLoyalty } from './api'
import { LoyaltyPointsCard } from './points-card'
import { LoyaltyPointsHistory } from './points-history'
import { LoyaltyTierBenefits } from './tier-benefits'

/** History rows shown here; the account page lists them all. */
const HISTORY_PREVIEW = 5

export const LoyaltyWidget = memo(function LoyaltyWidget() {
  const open = useUi((s) => s.loyaltyOpen)
  const setOpen = useUi((s) => s.setLoyaltyOpen)
  const user = useSession((s) => s.user)
  const t = useT()
  const navigate = useNavigate()
  const { data: summary, isLoading } = useLoyalty()

  const go = (to: '/login' | '/account/loyalty') => {
    setOpen(false)
    void navigate({ to })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 bg-canvas p-0 sm:max-w-sm">
        <SheetHeader className="flex-row items-center gap-3 border-b bg-white px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Gift className="size-4.5" />
          </span>
          <div className="min-w-0">
            <SheetTitle>{t('nav.loyalty')}</SheetTitle>
            <SheetDescription className="text-xs">
              {t('home.earnRateExplainerShort')}
            </SheetDescription>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {!user ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-8 text-center shadow-soft ring-1 ring-slate-200/80">
              <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                <LogIn className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">{t('home.loyaltyLoginTitle')}</p>
                <p className="mt-1 text-xs text-slate-500">{t('home.loyaltyLoginDesc')}</p>
              </div>
              <Button className="h-10 rounded-xl px-5" onClick={() => go('/login')}>
                {t('auth.login')}
              </Button>
            </div>
          ) : isLoading || !summary ? (
            <>
              <Skeleton className="h-52 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </>
          ) : (
            <>
              <LoyaltyPointsCard summary={summary} />

              <section className="rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-200/80">
                <h3 className="mb-3 text-sm font-semibold">
                  {t('home.tierBenefits', { name: summary.tier.name })}
                </h3>
                <LoyaltyTierBenefits tier={summary.tier} />
              </section>

              <section className="rounded-2xl bg-white p-5 pb-3 shadow-soft ring-1 ring-slate-200/80">
                <h3 className="text-sm font-semibold">{t('home.pointsHistory')}</h3>
                {summary.history.length === 0 ? (
                  <p className="mt-2 flex items-start gap-2 text-sm text-slate-500">
                    <Bus className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t('home.historyEmpty')}
                  </p>
                ) : (
                  <LoyaltyPointsHistory history={summary.history.slice(0, HISTORY_PREVIEW)} />
                )}
              </section>

              {summary.history.length > HISTORY_PREVIEW && (
                <Button
                  variant="outline"
                  className="h-11 w-full rounded-xl bg-white"
                  onClick={() => go('/account/loyalty')}
                >
                  {t('home.seeAllHistory')}
                </Button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
})
