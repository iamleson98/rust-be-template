'use client'

// Extracted from the original 'loyalty-widget.tsx'.

import { Button } from '@/components/ui/button'
import { formatCurrency, type Currency } from '@/lib/currency'
import { ArrowRight, Zap, Ticket } from 'lucide-react'
import { VOUCHERS, type Voucher } from './loyalty-data'

export function LoyaltyVoucherList({
  loyaltyPoints,
  currency,
  handleRedeem,
}: {
  loyaltyPoints: number
  currency: Currency
  handleRedeem: (voucher: Voucher) => void
}) {
  return (
    <div>
      <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
        <Ticket className="h-4 w-4 text-blue-600" />
        Đổi điểm
      </h3>
      <div className="space-y-2">
        {VOUCHERS.map((v) => {
          const canRedeem = loyaltyPoints >= v.points
          return (
            <div
              key={v.points}
              className={`rounded-lg border p-3 flex items-center justify-between gap-3 transition-colors ${canRedeem ? 'bg-white hover:border-blue-300' : 'bg-slate-50 opacity-60'
                }`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">Voucher {formatCurrency(v.value, currency)}</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {v.points.toLocaleString('vi-VN')} điểm
                </div>
              </div>
              <Button
                size="sm"
                variant={canRedeem ? 'default' : 'outline'}
                disabled={!canRedeem}
                onClick={() => handleRedeem(v)}
                className={`gap-1 text-xs shrink-0 ${canRedeem ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''
                  }`}
              >
                Đổi
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
