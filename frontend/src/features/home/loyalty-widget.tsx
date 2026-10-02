'use client'

/**
 * LoyaltyWidget — the customer-facing loyalty side panel (opened from
 * the header's gift button).
 *
 * REAL-DATA REWORK (2026-09): the panel renders the backend loyalty
 * summary (`GET /api/loyalty`, computed from the user's completed
 * bookings — 1 point per 10,000 VND). The old client-side point wallet
 * (Zustand `loyaltyPoints` + MOCK_HISTORY + VOUCHERS) is gone: no
 * client-side point math, no fake vouchers, no invented history.
 *
 * Signed-out visitors get a sign-in prompt (the summary is
 * auth-guarded on the backend).
 */

import { memo } from 'react'
import { useApp } from '@/lib/store'
import { useLoyalty } from '@/lib/queries'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/lib/i18n'
import { Gift, X, LogIn, Bus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { LoyaltyPointsCard } from './loyalty-points-card'
import { LoyaltyTierBenefits } from './loyalty-tier-benefits'
import { LoyaltyPointsHistory } from './loyalty-points-history'

export const LoyaltyWidget = memo(function LoyaltyWidget() {
  const { loyaltyOpen, setLoyaltyOpen, user } = useApp()
  const t = useT()
  const navigate = useNavigate()

  // Real backend summary — only fetched for signed-in users.
  const { data: summary, isLoading } = useLoyalty({ enabled: !!user })

  return (
    <>
      {loyaltyOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setLoyaltyOpen(false)}
          />

          {/* Panel */}
          <div className="fixed top-0 bottom-0 right-0 z-50 flex w-full flex-col bg-white sm:w-96">
            {/* Header */}
            <div className="border-b bg-linear-to-r from-blue-50 to-blue-50 px-4 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                    <Gift className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold">{t('nav.loyalty')}</h2>
                    <p className="text-[11px] text-muted-foreground">DatXeVui Loyalty</p>
                  </div>
                </div>
                <button
                  onClick={() => setLoyaltyOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="space-y-5 p-4">
                {!user ? (
                  /* Signed-out prompt */
                  <div className="flex flex-col items-center gap-3 rounded-xl border bg-slate-50 p-8 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                      <LogIn className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{t('home.loyaltyLoginTitle')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('home.loyaltyLoginDesc')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        setLoyaltyOpen(false)
                        navigate({ to: '/login' })
                      }}
                    >
                      <LogIn className="h-3.5 w-3.5" /> {t('auth.login')}
                    </Button>
                  </div>
                ) : isLoading || !summary ? (
                  /* Loading skeleton — structure-matched */
                  <div className="space-y-5">
                    <Skeleton className="h-44 w-full rounded-xl" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Points balance + tier + progress (real) */}
                    <LoyaltyPointsCard summary={summary} />

                    {/* Tier benefits (backend benefitCodes) */}
                    <LoyaltyTierBenefits tier={summary.tier} />

                    {/* Earning history (real completed bookings) */}
                    <LoyaltyPointsHistory history={summary.history} />

                    {/* Earn-rate explainer — the one business rule */}
                    <div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-700">
                      <Bus className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>{t('home.earnRateExplainer')}</span>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </div>
        </>
      )}
    </>
  )
})
