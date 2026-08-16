'use client'

import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { useRecommendations, type RecommendationItem } from '@/lib/queries'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ErrorState } from './empty-states'
import { formatDuration } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import {
  Sparkles,
  ArrowRight,
  Bus,
  Clock,
  TrendingUp,
  Heart,
  History,
  Compass,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { buildSearchInput } from '@/lib/search-params'

const REASON_STYLES: Record<
  RecommendationItem['reason'],
  { gradient: string; badgeBg: string; badgeText: string; icon: typeof TrendingUp }
> = {
  recent: {
    gradient: 'from-violet-500 to-fuchsia-500',
    badgeBg: 'bg-violet-100',
    badgeText: 'text-violet-700',
    icon: History,
  },
  wishlist: {
    gradient: 'from-rose-500 to-pink-500',
    badgeBg: 'bg-rose-100',
    badgeText: 'text-rose-700',
    icon: Heart,
  },
  booking: {
    gradient: 'from-blue-500 to-blue-500',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
    icon: Compass,
  },
  trending: {
    gradient: 'from-amber-500 to-orange-500',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-700',
    icon: TrendingUp,
  },
}

export function Recommendations() {
  const { user, guestPhone, recentlyViewed, currency } = useApp()
  const navigate = useNavigate()

  // ── Data: TanStack Query ─────────────────────────────────────────
  // The hook builds the `phone` + `recent` (comma-joined routeIds)
  // query string internally — we just pass the raw inputs.
  const { data, isLoading, isError, refetch } = useRecommendations({
    phone: user?.phone ?? guestPhone,
    recentRouteIds: recentlyViewed.map((r) => r.routeId),
  })
  const items: RecommendationItem[] = data?.items ?? []

  // Click → navigate to /search with the recommended route's from/to.
  // The /search route owns the actual trip-search fetch via useTripSearch.
  const handleView = (rec: RecommendationItem) => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const date = tomorrow.toISOString().slice(0, 10)
    navigate({
      to: '/search',
      search: buildSearchInput({ from: rec.fromName, to: rec.toName, date }),
    })
  }

  if (isLoading) {
    return (
      <section className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-9 w-9 rounded-full bg-linear-to-br from-blue-500 to-blue-500 text-white inline-flex items-center justify-center">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="font-bold text-lg md:text-xl tracking-tight">Gợi ý cho bạn</h2>
            <p className="text-xs text-muted-foreground">Đang phân tích sở thích của bạn...</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground text-sm py-8">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Đang tải gợi ý chuyến đi...
        </div>
      </section>
    )
  }

  if (isError) {
    return (
      <section className="container mx-auto px-4 py-8">
        <ErrorState
          description="Không thể tải gợi ý chuyến đi. Vui lòng thử lại."
          onRetry={() => refetch()}
        />
      </section>
    )
  }

  if (items.length === 0) return null

  return (
    <section className="py-8 md:py-10 bg-linear-to-b from-blue-50/40 via-white to-white">
      <div className="container mx-auto px-4">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-full bg-linear-to-br from-blue-500 to-blue-500 text-white inline-flex items-center justify-center">
                <Sparkles className="h-4.5 w-4.5" />
              </div>
              <div>
                <h2 className="font-bold text-lg md:text-xl tracking-tight">Gợi ý cho bạn</h2>
                <p className="text-xs text-muted-foreground">
                  {user
                    ? `Cá nhân hoá theo hoạt động của ${user.name}`
                    : 'Dựa trên tuyến phổ biến — đăng nhập để nhận gợi ý chính xác hơn'}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() =>
                navigate({
                  to: '/search',
                  search: buildSearchInput({ from: '', to: '', date: '' }),
                })
              }
            >
              Tất cả chuyến
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Horizontal scroll on mobile, grid on desktop */}
          <div className="flex md:grid md:grid-cols-4 gap-3 overflow-x-auto md:overflow-visible snap-x snap-mandatory pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0">
            {items.map((rec) => {
              const style = REASON_STYLES[rec.reason] ?? REASON_STYLES.trending
              const ReasonIcon = style.icon
              return (
                <div
                  key={rec.tripId + rec.routeId}
                  className="snap-start shrink-0 w-[78vw] sm:w-[320px] md:w-auto"
                >
                  <Card className="overflow-hidden ring-1 ring-black/5 shadow-sm hover:shadow-md transition-all duration-300 h-full flex flex-col">
                    {/* Gradient accent header */}
                    <div className={`h-1.5 bg-linear-to-r ${style.gradient}`} />
                    <div className="p-4 flex-1 flex flex-col gap-3">
                      {/* Reason badge */}
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.badgeBg} ${style.badgeText}`}>
                          <ReasonIcon className="h-3 w-3" />
                          {rec.reasonLabel}
                        </span>
                        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                          <Bus className="h-3 w-3" style={{ color: rec.brandAccent }} />
                          {rec.brandName}
                        </span>
                      </div>

                      {/* Route */}
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-base truncate">{rec.fromName}</div>
                          <div className="text-[10px] text-muted-foreground">Điểm đi</div>
                        </div>
                        <div className={`shrink-0 h-8 w-8 rounded-full bg-linear-to-br ${style.gradient} text-white flex items-center justify-center`}>
                          <ArrowRight className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1 text-right">
                          <div className="font-bold text-base truncate">{rec.toName}</div>
                          <div className="text-[10px] text-muted-foreground">Điểm đến</div>
                        </div>
                      </div>

                      {/* Meta */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(rec.durationMin)}
                        </span>
                        <span className="font-medium text-blue-700">{rec.departureTime}</span>
                      </div>

                      {/* Price + CTA */}
                      <div className="flex items-end justify-between gap-2 mt-auto pt-2">
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Giá từ</div>
                          <div className="text-base font-extrabold text-blue-700">
                            {formatCurrency(rec.minPrice, currency)}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleView(rec)}
                          className={`gap-1 bg-linear-to-r ${style.gradient} text-white hover:opacity-90`}
                        >
                          Xem chuyến
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                </div>
              )
            })}
          </div>

          {/* Hint to scroll horizontally on mobile */}
          <div className="md:hidden mt-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
            <ChevronRight className="h-3 w-3" />
            Vuốt để xem thêm gợi ý
          </div>
        </div>
      </div>
    </section>
  )
}
