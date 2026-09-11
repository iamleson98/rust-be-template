'use client'

import { memo, useEffect, useState, useRef, useCallback } from 'react'
import { useCampaigns, type Campaign } from '@/lib/queries'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/layout/error-state'
import { Tag, Copy, Check, Zap, Timer, Flame } from 'lucide-react'
import { toast } from 'sonner'
import { CampaignsSkeleton } from '@/features/home/components/campaigns-skeleton'

/* Countdown timer for campaigns */
function CampaignCountdown({ endTime }: { endTime: number }) {
  const [timeLeft, setTimeLeft] = useState(endTime - Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(endTime - Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [endTime])

  if (timeLeft <= 0) return <span className="text-[10px] text-muted-foreground">Đã hết hạn</span>

  const hours = Math.floor(timeLeft / 3600000)
  const minutes = Math.floor((timeLeft % 3600000) / 60000)
  const seconds = Math.floor((timeLeft % 60000) / 1000)

  return (
    <div className="flex items-center gap-1 text-[11px] font-mono">
      <Timer className="h-3 w-3 text-amber-500" />
      <span className="text-amber-600 font-semibold">
        {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </span>
    </div>
  )
}

export const CampaignsBanner = memo(function CampaignsBanner() {
  const { data, isLoading, isError, refetch } = useCampaigns()
  const items: Campaign[] = data?.items ?? []
  const [copied, setCopied] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  /* Auto-scroll carousel for campaign cards */
  useEffect(() => {
    if (items.length <= 3) return
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % items.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [items.length])

  const copy = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopied(code)
    toast.success('Đã sao chép mã khuyến mãi!', {
      description: `Mã ${code} đã được chép vào clipboard`,
      duration: 2500,
    })
    setTimeout(() => setCopied(null), 1500)
  }

  const typeLabel = (t: string, v: number) => {
    if (t === 'percent') return `Giảm ${v}%`
    if (t === 'fixed_amount') return `Giảm ${v.toLocaleString('vi-VN')}đ`
    if (t === 'free_child') return 'Trẻ em miễn phí'
    if (t === 'seat_upgrade') return 'Tặng nâng hạng'
    return 'Ưu đãi'
  }

  /* Generate deterministic end time for each campaign (24-72h from now) */
  const getEndTime = useCallback((id: string) => {
    let hash = 0
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash)
    }
    const hoursOffset = 24 + (Math.abs(hash) % 48)
    return Date.now() + hoursOffset * 3600000
  }, [])

  // Deterministic "featured" flag (every 3rd card is hot)
  const isFeatured = (id: string, i: number) => i % 3 === 0

  return (
    <section className="bg-linear-to-br from-amber-50 via-orange-50 to-rose-50 border-y border-amber-100/80">
      <div className="container mx-auto px-4 py-12">
        {isLoading ? (
          <CampaignsSkeleton count={3} />
        ) : isError ? (
          <ErrorState
            description="Không thể tải mã khuyến mãi. Vui lòng thử lại."
            onRetry={() => refetch()}
          />
        ) : items.length === 0 ? null : (
          <>
            <div className="flex items-end justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Tag className="h-5 w-5 text-rose-500" />
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Mã khuyến mãi hot</h2>
                </div>
                <p className="text-muted-foreground text-sm">Áp dụng ngay khi đặt vé — số lượng có hạn</p>
              </div>
              {/* Carousel dots indicator */}
              {items.length > 3 && (
                <div className="hidden sm:flex items-center gap-1.5">
                  {items.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveIndex(i)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${i === activeIndex ? 'w-4 bg-rose-500' : 'w-1.5 bg-rose-300/40 hover:bg-rose-400/60'
                        }`}
                      aria-label={`Xem mã ${i + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>

            <div
              ref={scrollRef}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {items.map((c, i) => {
                // `CampaignOut` only exposes `code`, `discountType`,
                // `discountValue`, `endsAt`, `id`. We use a fixed rose banner color
                // since the API no longer returns one.
                const bannerColor = '#f43f5e'
                return (
                  <div
                    key={c.id}
                    className={i === activeIndex ? 'ring-2 ring-rose-400/30 rounded-xl' : ''}
                  >
                    <Card className="relative overflow-hidden border-0 h-full">
                      {/* Shimmer sweep overlay */}
                      <div className="absolute inset-0 -translate-x-full hover:translate-x-full transition-transform duration-1500 bg-linear-to-r from-transparent via-white/40 to-transparent skew-x-12 pointer-events-none z-10" />

                      {/* Gradient overlay on the card top */}
                      <div
                        className="absolute inset-x-0 top-0 h-20 opacity-10 hover:opacity-20 transition-opacity"
                        style={{ background: `linear-gradient(180deg, ${bannerColor}, transparent)` }}
                      />
                      {/* Banner stripe */}
                      <div className="absolute left-0 top-0 bottom-0 w-1.5 transition-all hover:w-2 duration-300" style={{ background: bannerColor }} />

                      {/* Decorative circles */}
                      <div
                        className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-10 hover:opacity-20 transition-opacity"
                        style={{ background: bannerColor }}
                      />

                      {/* "Hot" badge with pulse animation on featured campaigns */}
                      {isFeatured(c.id, i) && (
                        <div className="absolute top-3 right-3 z-20">
                          <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-rose-500 to-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
                            <Flame className="h-3 w-3" />
                            HOT
                          </span>
                        </div>
                      )}

                      <div className="p-5 pl-6 relative">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Badge
                              className="mb-2 text-[11px] font-bold"
                              style={{ background: `${bannerColor}20`, color: bannerColor }}
                            >
                              <Zap className="h-3 w-3 mr-0.5" />
                              {typeLabel(c.discountType, c.discountValue)}
                            </Badge>
                            <h3 className="font-bold text-base leading-snug">{c.code}</h3>
                          </div>
                          {/* Countdown timer */}
                          <CampaignCountdown endTime={getEndTime(c.id)} />
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <code
                              className="rounded-md px-2.5 py-1.5 text-sm font-mono font-bold tracking-wider border-2 border-dashed"
                              style={{ borderColor: `${bannerColor}50`, color: bannerColor }}
                            >
                              {c.code}
                            </code>
                          </div>
                          <button
                            onClick={() => copy(c.code)}
                            className="inline-flex items-center gap-1 rounded-lg px-3.5 py-2 text-xs font-bold text-white transition-all"
                            style={{ background: bannerColor }}
                          >
                            {copied === c.code ? (
                              <>
                                <Check className="h-3.5 w-3.5" /> Đã chép
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" /> Sao chép
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </Card>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </section>
  )
})
