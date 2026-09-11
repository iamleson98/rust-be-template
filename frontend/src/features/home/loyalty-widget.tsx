'use client'

import { memo } from 'react'
import { useApp } from '@/lib/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatCurrency } from '@/lib/currency'
import { Gift, X } from 'lucide-react'
import { toast } from 'sonner'
import { getNextTier, getTier, type Voucher } from './loyalty-data'
import { LoyaltyPointsCard } from './loyalty-points-card'
import { LoyaltyTierBenefits } from './loyalty-tier-benefits'
import { LoyaltyVoucherList } from './loyalty-voucher-list'
import { LoyaltyPointsHistory } from './loyalty-points-history'
import { LoyaltyTiersOverview } from './loyalty-tiers-overview'

export const LoyaltyWidget = memo(function LoyaltyWidget() {
  const { loyaltyOpen, setLoyaltyOpen, loyaltyPoints, setLoyaltyPoints, currency } = useApp()

  const currentTier = getTier(loyaltyPoints)
  const nextTier = getNextTier(loyaltyPoints)

  const handleRedeem = (voucher: Voucher) => {
    if (loyaltyPoints < voucher.points) return
    setLoyaltyPoints((prev) => prev - voucher.points)
    toast.success(`Đổi thành công Voucher ${formatCurrency(voucher.value, currency)}!`, {
      description: `Đã trừ ${voucher.points} điểm. Voucher sẽ được gửi qua SMS.`,
      duration: 4000,
    })
  }

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
          <div




            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-96 bg-white flex flex-col"
          >
            {/* Header */}
            <div className="px-4 py-4 border-b bg-linear-to-r from-blue-50 to-blue-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
                    <Gift className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="font-extrabold text-sm">Điểm thưởng</h2>
                    <p className="text-[11px] text-muted-foreground">DatXeVui Loyalty</p>
                  </div>
                </div>
                <button
                  onClick={() => setLoyaltyOpen(false)}
                  className="h-8 w-8 rounded-lg hover:bg-slate-100 inline-flex items-center justify-center transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-5">
                {/* Points balance */}
                <LoyaltyPointsCard
                  loyaltyPoints={loyaltyPoints}
                  currentTier={currentTier}
                  nextTier={nextTier}
                />

                {/* Tier benefits */}
                <LoyaltyTierBenefits currentTier={currentTier} />

                {/* Voucher redemption */}
                <LoyaltyVoucherList
                  loyaltyPoints={loyaltyPoints}
                  currency={currency}
                  handleRedeem={handleRedeem}
                />

                {/* Points history */}
                <LoyaltyPointsHistory />

                {/* All tiers overview */}
                <LoyaltyTiersOverview currentTier={currentTier} />
              </div>
            </ScrollArea>
          </div>
        </>
      )}
    </>
  )
})
