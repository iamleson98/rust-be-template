'use client'

import { memo } from 'react'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { History, ChevronRight, Bus, Clock } from 'lucide-react'
import { relativeTime } from '@/lib/types'
import { buildSearchInput } from '@/lib/search-params'

function RecentlyViewedImpl() {
  const { recentlyViewed, pushRecentlyViewed } = useApp()
  const navigate = useNavigate()

  // Don't render if no recently viewed items
  if (recentlyViewed.length === 0) return null

  // Reopen the trip detail by navigating to its deep-link URL.
  // (Was: `selectTrip(tripId)` in the Zustand store — now a real route.)
  const handleReopen = (tripId: string, label: string, brandName: string, routeId: string) => {
    pushRecentlyViewed({ tripId, routeId, label, brandName })
    navigate({ to: '/trips/$tripId', params: { tripId } })
  }

  return (
    <section className="py-8 md:py-10 bg-linear-to-b from-white to-slate-50/50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full bg-linear-to-br from-violet-500 to-fuchsia-500 text-white inline-flex items-center justify-center">
              <History className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="font-bold text-lg md:text-xl tracking-tight">Vừa xem gần đây</h2>
              <p className="text-xs text-muted-foreground">
                {recentlyViewed.length} chuyến bạn vừa xem — tiếp tục đặt ngay
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
            Tất cả kết quả
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {recentlyViewed.slice(0, 4).map((rv) => (
            <Card
              key={rv.tripId}
              className="ring-1 ring-black/5 hover:ring-violet-300 transition-all cursor-pointer overflow-hidden group"
              onClick={() => handleReopen(rv.tripId, rv.label, rv.brandName, rv.routeId)}
            >
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-md bg-linear-to-br from-violet-500 to-fuchsia-500 text-white inline-flex items-center justify-center text-[10px] font-bold shrink-0">
                    <Bus className="h-3.5 w-3.5" />
                  </div>
                  <div className="text-xs font-semibold text-violet-700 truncate">{rv.brandName}</div>
                  <span className="ml-auto text-[10px] text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {relativeTime(new Date(rv.seenAt).toISOString())}
                  </span>
                </div>
                <div className="font-semibold text-sm line-clamp-2 leading-snug">{rv.label}</div>
                <div className="mt-2 inline-flex items-center gap-1 text-xs text-blue-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Mở lại chi tiết
                  <ChevronRight className="h-3 w-3" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

export const RecentlyViewed = memo(RecentlyViewedImpl)
