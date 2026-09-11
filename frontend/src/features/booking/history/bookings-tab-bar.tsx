'use client'

// Extracted from the original 'my-bookings.tsx'.

import { CalendarCheck, History, X, Star } from 'lucide-react'
import { TabsList } from '@/components/ui/tabs'
import { UserTabTrigger } from './user-tab-trigger'

export function BookingsTabBar({
  upcomingCount,
  pastCount,
  cancelledCount,
  reviewableCount,
}: {
  upcomingCount: number
  pastCount: number
  cancelledCount: number
  reviewableCount: number
}) {
  return (
    <div className="flex justify-center">
      <TabsList className="bg-white ring-1 ring-black/5 backdrop-blur h-auto p-1.5 rounded-xl gap-1 flex-wrap">
        <UserTabTrigger
          value="upcoming"
          icon={<CalendarCheck className="h-4 w-4" />}
          label="Sắp đi"
          count={upcomingCount}
          activeClass="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"
        />
        <UserTabTrigger
          value="past"
          icon={<History className="h-4 w-4" />}
          label="Đã đi"
          count={pastCount}
          activeClass="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"
        />
        <UserTabTrigger
          value="cancelled"
          icon={<X className="h-4 w-4" />}
          label="Đã hủy"
          count={cancelledCount}
          activeClass="data-[state=active]:bg-rose-50 data-[state=active]:text-rose-700"
        />
        <UserTabTrigger
          value="reviews"
          icon={<Star className="h-4 w-4" />}
          label="Đánh giá"
          count={reviewableCount}
          activeClass="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700"
          badgeClass="bg-amber-100 text-amber-700"
        />
      </TabsList>
    </div>
  )
}
