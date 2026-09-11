'use client'

// Extracted from the original 'my-bookings.tsx'.

import { Bus, User, Ticket } from 'lucide-react'

export function BookingsHero({
  isUserLoggedIn,
  user,
}: {
  isUserLoggedIn: boolean
  user: { name: string } | null | undefined
}) {
  return (
    <div className="relative overflow-hidden bg-linear-to-br from-blue-700 via-blue-800 to-blue-900 text-white">
      <div className="absolute inset-0 opacity-[0.06]">
        <div className="absolute top-4 left-[10%]"><Bus className="h-16 w-16 rotate-[-15deg]" /></div>
        <div className="absolute top-20 right-[15%]"><Bus className="h-12 w-12 rotate-10" /></div>
        <div className="absolute bottom-8 left-[30%]"><Bus className="h-10 w-10 rotate-[-5deg]" /></div>
        <div className="absolute top-2 right-[45%]"><Bus className="h-8 w-8 rotate-20" /></div>
        <div className="absolute bottom-4 right-[8%]"><Bus className="h-14 w-14 rotate-[-10deg]" /></div>
        <div className="absolute top-16 left-[60%]"><Bus className="h-9 w-9 rotate-15" /></div>
      </div>
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 50%, white 0, transparent 50%), radial-gradient(circle at 85% 70%, white 0, transparent 50%)',
        }}
      />
      <div className="container mx-auto px-4 py-12 md:py-16 relative">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold ring-1 ring-white/20 mb-5">
            {isUserLoggedIn ? (
              <>
                <User className="h-3.5 w-3.5" />
                Xin chào, {user?.name}
              </>
            ) : (
              <>
                <Ticket className="h-3.5 w-3.5" />
                Tra cứu vé xe trực tuyến
              </>
            )}
          </div>
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight mb-3 leading-tight">
            {isUserLoggedIn ? 'Lịch sử đặt vé của tôi' : 'Tra cứu vé đã đặt'}
          </h1>
          <p className="text-blue-100 text-sm md:text-base leading-relaxed max-w-lg">
            {isUserLoggedIn
              ? 'Xem lại các chuyến đi sắp đi, đã đi, đã hủy và để lại đánh giá cho từng chuyến hoàn thành.'
              : 'Nhập mã vé hoặc số điện thoại để xem chi tiết đặt vé, trạng thái chuyến đi và thông tin hành khách'}
          </p>
        </div>
      </div>
      <svg
        className="absolute bottom-0 left-0 w-full"
        viewBox="0 0 1440 60"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <path d="M0 60V30C240 0 480 0 720 30C960 60 1200 60 1440 30V60H0Z" fill="white" fillOpacity="0.06" />
        <path d="M0 60V40C360 10 720 10 1080 40C1260 55 1350 55 1440 40V60H0Z" fill="white" fillOpacity="0.04" />
      </svg>
    </div>
  )
}
