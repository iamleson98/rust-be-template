'use client'

import { memo } from 'react'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatCurrency } from '@/lib/currency'
import {
  Gift,
  Star,
  Trophy,
  Crown,
  Medal,
  ArrowRight,
  X,
  History,
  Ticket,
  Sparkles,
  CheckCircle2,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'

type Tier = {
  key: string
  name: string
  min: number
  max: number
  icon: React.ReactNode
  color: string
  bg: string
  benefits: string[]
}

const TIERS: Tier[] = [
  {
    key: 'platinum',
    name: 'Platinum',
    min: 20000,
    max: Infinity,
    icon: <Crown className="h-5 w-5" />,
    color: 'text-violet-600',
    bg: 'bg-violet-100',
    benefits: ['Giảm 15% cho mọi chuyến', 'Ưu tiên chọn ghế', 'Hoàn vé miễn phí', 'Voucher 150K mỗi tháng'],
  },
  {
    key: 'gold',
    name: 'Gold',
    min: 5000,
    max: 19999,
    icon: <Trophy className="h-5 w-5" />,
    color: 'text-amber-600',
    bg: 'bg-amber-100',
    benefits: ['Giảm 10% cho mọi chuyến', 'Ưu tiên chọn ghế', 'Voucher 60K mỗi tháng'],
  },
  {
    key: 'silver',
    name: 'Silver',
    min: 1000,
    max: 4999,
    icon: <Medal className="h-5 w-5" />,
    color: 'text-slate-500',
    bg: 'bg-slate-100',
    benefits: ['Giảm 5% cho mọi chuyến', 'Voucher 25K mỗi tháng'],
  },
  {
    key: 'bronze',
    name: 'Bronze',
    min: 0,
    max: 999,
    icon: <Star className="h-5 w-5" />,
    color: 'text-orange-600',
    bg: 'bg-orange-100',
    benefits: ['Tích điểm mỗi chuyến', 'Đổi điểm lấy voucher'],
  },
]

type Voucher = {
  points: number
  value: number
  label: string
}

const VOUCHERS: Voucher[] = [
  { points: 500, value: 25000, label: 'Voucher 25.000đ' },
  { points: 1000, value: 60000, label: 'Voucher 60.000đ' },
  { points: 2000, value: 150000, label: 'Voucher 150.000đ' },
]

type PointsHistory = {
  id: string
  description: string
  amount: number
  date: string
}

const MOCK_HISTORY: PointsHistory[] = [
  { id: '1', description: 'Đặt vé HN→SG', amount: 150, date: '2025-07-15' },
  { id: '2', description: 'Đặt vé ĐN→NT', amount: 85, date: '2025-07-10' },
  { id: '3', description: 'Đổi voucher', amount: -500, date: '2025-07-08' },
  { id: '4', description: 'Đặt vé SG→ĐL', amount: 120, date: '2025-07-01' },
  { id: '5', description: 'Đặt vé HN→HP', amount: 30, date: '2025-06-25' },
]

function getTier(points: number): Tier {
  return TIERS.find((t) => points >= t.min && points <= t.max) ?? TIERS[TIERS.length - 1]
}

function getNextTier(points: number): Tier | null {
  const currentTier = getTier(points)
  const currentIdx = TIERS.findIndex((t) => t.key === currentTier.key)
  // TIERS are ordered from highest to lowest, so"next"is the one above (lower index)
  if (currentIdx > 0) return TIERS[currentIdx - 1]
  return null
}

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
                <div className="rounded-xl border bg-linear-to-br from-blue-50 to-blue-50 p-4 text-center">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Số điểm hiện tại</div>
                  <div className="text-4xl font-extrabold text-blue-700 mt-1">
                    {loyaltyPoints.toLocaleString('vi-VN')}
                  </div>

                  {/* Tier badge */}
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border"
                    style={{
                      borderColor: currentTier.key === 'platinum' ? '#7c3aed' : currentTier.key === 'gold' ? '#d97706' : currentTier.key === 'silver' ? '#64748b' : '#ea580c',
                      background: currentTier.bg,
                      color: currentTier.key === 'platinum' ? '#7c3aed' : currentTier.key === 'gold' ? '#d97706' : currentTier.key === 'silver' ? '#64748b' : '#ea580c',
                    }}
                  >
                    {currentTier.icon}
                    {currentTier.name}
                  </div>

                  {/* Progress to next tier */}
                  {nextTier && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                        <span>{currentTier.name}</span>
                        <span>{nextTier.name} ({nextTier.max + 1} điểm)</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div



                          className="h-full rounded-full bg-linear-to-r from-blue-500 to-blue-500"
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Cần thêm {nextTier.max + 1 - loyaltyPoints} điểm để lên {nextTier.name}
                      </div>
                    </div>
                  )}
                </div>

                {/* Tier benefits */}
                <div>
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    Quyền lợi {currentTier.name}
                  </h3>
                  <div className="space-y-1.5">
                    {currentTier.benefits.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                        {b}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Voucher redemption */}
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

                {/* Points history */}
                <div>
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
                    <History className="h-4 w-4 text-slate-500" />
                    Lịch sử điểm
                  </h3>
                  <div className="space-y-1.5">
                    {MOCK_HISTORY.map((h) => (
                      <div key={h.id} className="flex items-center justify-between text-xs py-1.5 border-b border-dashed border-slate-200 last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-700 truncate">{h.description}</div>
                          <div className="text-[10px] text-muted-foreground">{h.date}</div>
                        </div>
                        <span className={`font-bold ${h.amount > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                          {h.amount > 0 ? '+' : ''}{h.amount} điểm
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* All tiers overview */}
                <div>
                  <h3 className="font-semibold text-sm mb-2">Các hạng thành viên</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {TIERS.map((t) => {
                      const isCurrent = t.key === currentTier.key
                      return (
                        <div
                          key={t.key}
                          className={`rounded-lg border p-2.5 text-center transition-all ${isCurrent ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'bg-slate-50'
                            }`}
                        >
                          <div className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${t.bg} ${t.color} mb-1`}>
                            {t.icon}
                          </div>
                          <div className="text-xs font-bold">{t.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {t.max === Infinity ? `${t.min.toLocaleString('vi-VN')}+` : `${t.min}–${t.max.toLocaleString('vi-VN')}`}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </>
      )}
    </>
  )
})
