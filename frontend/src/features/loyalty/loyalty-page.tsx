/**
 * `/account/loyalty` — the customer's points, tier, benefits and the
 * full earning history. Everything comes from the backend summary
 * (`GET /api/loyalty`, 1 point per 10,000 VND of completed bookings);
 * this page only lays it out.
 */

import { useNavigate } from '@tanstack/react-router'
import { Bus, History, LogIn, Sparkles } from 'lucide-react'
import { ConsolePage, PageHeader } from '@/components/console/page'
import { EmptyState, Panel } from '@/components/console/panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/lib/i18n'
import { useSession } from '@/stores/session'
import { useLoyalty } from './api'
import { LoyaltyPointsCard } from './points-card'
import { LoyaltyPointsHistory } from './points-history'
import { LoyaltyTierBenefits } from './tier-benefits'

export function AccountLoyaltyPage() {
  const user = useSession((s) => s.user)
  const t = useT()
  const navigate = useNavigate()
  const { data: summary, isLoading } = useLoyalty()

  if (!user) {
    return (
      <ConsolePage width="narrow">
        <Panel>
          <EmptyState
            icon={<LogIn />}
            text={
              <>
                <span className="block font-medium text-foreground">
                  {t('home.loyaltyLoginTitle')}
                </span>
                {t('home.loyaltyLoginDesc')}
              </>
            }
            action={
              <Button size="sm" onClick={() => navigate({ to: '/login' })}>
                {t('auth.login')}
              </Button>
            }
          />
        </Panel>
      </ConsolePage>
    )
  }

  return (
    <ConsolePage>
      <PageHeader title={t('nav.loyalty')} description={t('home.earnRateExplainerShort')} />

      {isLoading || !summary ? (
        <>
          <Skeleton className="h-52 w-full rounded-2xl" />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        </>
      ) : (
        <>
          <LoyaltyPointsCard summary={summary} />

          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
            <Panel icon={<Sparkles />} title={t('home.tierBenefits', { name: summary.tier.name })}>
              <LoyaltyTierBenefits tier={summary.tier} />
            </Panel>

            <Panel icon={<History />} title={t('home.pointsHistory')} bodyClassName="py-1">
              {summary.history.length === 0 ? (
                <EmptyState
                  icon={<Bus />}
                  text={t('home.historyEmpty')}
                  action={
                    <Button variant="outline" size="sm" onClick={() => navigate({ to: '/' })}>
                      {t('home.bookATrip')}
                    </Button>
                  }
                />
              ) : (
                <LoyaltyPointsHistory history={summary.history} />
              )}
            </Panel>
          </div>
        </>
      )}
    </ConsolePage>
  )
}
