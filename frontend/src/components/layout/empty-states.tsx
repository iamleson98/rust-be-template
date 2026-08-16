'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/* ─── SVG Illustrations (line-art style with teal accents) ─── */

function MagnifyingGlassSVG() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-full w-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Outer glow circle */}
      <circle cx="60" cy="60" r="50" fill="oklch(0.556 0.13 250 / 0.06)" />
      {/* Magnifying handle */}
      <line
        x1="78"
        y1="78"
        x2="98"
        y2="98"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* Lens circle */}
      <circle
        cx="52"
        cy="52"
        r="28"
        fill="white"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="4"
      />
      {/* Inner dotted search pattern */}
      <circle cx="52" cy="52" r="18" stroke="oklch(0.556 0.13 250 / 0.3)" strokeWidth="2" strokeDasharray="3 4" />
      {/* Question mark inside lens */}
      <path
        d="M48 46.5 C48 42, 52 40, 55 42 C58 44, 58 47, 55 49 C52 51, 52 53, 52 55"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="52" cy="60" r="1.5" fill="oklch(0.556 0.13 250)" />
      {/* Decorative small dots */}
      <circle cx="20" cy="30" r="2" fill="oklch(0.596 0.12 220 / 0.4)" />
      <circle cx="100" cy="40" r="2.5" fill="oklch(0.596 0.12 220 / 0.4)" />
      <circle cx="30" cy="100" r="2" fill="oklch(0.596 0.12 220 / 0.4)" />
    </svg>
  )
}

function TicketSVG() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-full w-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="60" cy="60" r="50" fill="oklch(0.556 0.13 250 / 0.06)" />
      {/* Ticket body — left part */}
      <path
        d="M20 42 L20 78 C20 80, 22 82, 24 82 L70 82 C72 82, 74 80, 74 78 L74 70 C70 70, 68 68, 68 64 C68 60, 70 58, 74 58 L74 42 C74 40, 72 38, 70 38 L24 38 C22 38, 20 40, 20 42 Z"
        fill="white"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Perforated divider */}
      <line
        x1="68"
        y1="40"
        x2="68"
        y2="80"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="2"
        strokeDasharray="3 3"
      />
      {/* Ticket body — right stub */}
      <path
        d="M74 42 L74 58 C78 58, 80 60, 80 64 C80 68, 78 70, 74 70 L74 78 C74 80, 76 82, 78 82 L94 82 C96 82, 98 80, 98 78 L98 42 C98 40, 96 38, 94 38 L78 38 C76 38, 74 40, 74 42 Z"
        fill="oklch(0.556 0.13 250 / 0.05)"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Lines on left ticket */}
      <line x1="30" y1="50" x2="55" y2="50" stroke="oklch(0.556 0.13 250 / 0.5)" strokeWidth="2" strokeLinecap="round" />
      <line x1="30" y1="58" x2="60" y2="58" stroke="oklch(0.556 0.13 250 / 0.5)" strokeWidth="2" strokeLinecap="round" />
      <line x1="30" y1="66" x2="48" y2="66" stroke="oklch(0.556 0.13 250 / 0.5)" strokeWidth="2" strokeLinecap="round" />
      {/* QR-like squares on stub */}
      <rect x="80" y="48" width="14" height="14" rx="2" fill="none" stroke="oklch(0.556 0.13 250)" strokeWidth="2" />
      <rect x="83" y="51" width="3" height="3" fill="oklch(0.556 0.13 250)" />
      <rect x="88" y="56" width="3" height="3" fill="oklch(0.556 0.13 250)" />
      <rect x="83" y="56" width="3" height="3" fill="oklch(0.556 0.13 250)" />
      {/* Decorative dots */}
      <circle cx="18" cy="100" r="2" fill="oklch(0.596 0.12 220 / 0.4)" />
      <circle cx="104" cy="28" r="2.5" fill="oklch(0.596 0.12 220 / 0.4)" />
    </svg>
  )
}

function HeartSVG() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-full w-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="60" cy="60" r="50" fill="oklch(0.556 0.13 250 / 0.06)" />
      {/* Heart outline */}
      <path
        d="M60 92 C58 90, 30 70, 30 50 C30 38, 40 30, 50 30 C56 30, 60 34, 60 38 C60 34, 64 30, 70 30 C80 30, 90 38, 90 50 C90 70, 62 90, 60 92 Z"
        fill="white"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Heartbeat line through middle */}
      <path
        d="M30 56 L42 56 L48 44 L54 68 L60 50 L66 62 L72 56 L90 56"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Sparkle decorations */}
      <path d="M22 28 L22 34 M19 31 L25 31" stroke="oklch(0.596 0.12 220)" strokeWidth="2" strokeLinecap="round" />
      <path d="M98 78 L98 84 M95 81 L101 81" stroke="oklch(0.596 0.12 220)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="100" cy="32" r="2" fill="oklch(0.596 0.12 220 / 0.5)" />
    </svg>
  )
}

function BellSVG() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-full w-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="60" cy="60" r="50" fill="oklch(0.556 0.13 250 / 0.06)" />
      {/* Bell body */}
      <path
        d="M40 76 C40 56, 50 42, 60 42 C70 42, 80 56, 80 76 L84 76 C86 76, 88 78, 88 80 C88 82, 86 84, 84 84 L36 84 C34 84, 32 82, 32 80 C32 78, 34 76, 36 76 Z"
        fill="white"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Bell top */}
      <path
        d="M56 42 C56 38, 58 36, 60 36 C62 36, 64 38, 64 42"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      {/* Clapper */}
      <circle cx="60" cy="90" r="4" fill="white" stroke="oklch(0.556 0.13 250)" strokeWidth="3" />
      {/* Notification dot */}
      <circle cx="82" cy="46" r="6" fill="oklch(0.596 0.12 220)" />
      <circle cx="82" cy="46" r="3" fill="white" />
      {/* Decorative sound waves */}
      <path d="M92 58 Q98 60, 98 66" stroke="oklch(0.556 0.13 250 / 0.4)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M28 58 Q22 60, 22 66" stroke="oklch(0.556 0.13 250 / 0.4)" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function StarSVG() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-full w-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="60" cy="60" r="50" fill="oklch(0.556 0.13 250 / 0.06)" />
      {/* Big star outline */}
      <path
        d="M60 32 L67 50 L86 52 L72 64 L76 84 L60 74 L44 84 L48 64 L34 52 L53 50 Z"
        fill="white"
        stroke="oklch(0.556 0.13 250)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Small stars around */}
      <path
        d="M22 30 L24 35 L29 35 L25 38 L27 43 L22 40 L17 43 L19 38 L15 35 L20 35 Z"
        fill="oklch(0.596 0.12 220 / 0.4)"
      />
      <path
        d="M98 90 L99 93 L102 93 L100 95 L101 98 L98 96 L95 98 L96 95 L94 93 L97 93 Z"
        fill="oklch(0.596 0.12 220 / 0.4)"
      />
      {/* Sparkle */}
      <path d="M100 32 L100 38 M97 35 L103 35" stroke="oklch(0.596 0.12 220)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function WarningSVG() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-full w-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="60" cy="60" r="50" fill="oklch(0.65 0.21 25 / 0.06)" />
      {/* Triangle warning */}
      <path
        d="M60 28 L96 90 L24 90 Z"
        fill="white"
        stroke="oklch(0.65 0.21 25)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Exclamation */}
      <line x1="60" y1="50" x2="60" y2="70" stroke="oklch(0.65 0.21 25)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="80" r="2.5" fill="oklch(0.65 0.21 25)" />
      {/* Decorative dots */}
      <circle cx="20" cy="40" r="2" fill="oklch(0.65 0.21 25 / 0.4)" />
      <circle cx="100" cy="50" r="2.5" fill="oklch(0.65 0.21 25 / 0.4)" />
      <circle cx="98" cy="92" r="2" fill="oklch(0.65 0.21 25 / 0.4)" />
    </svg>
  )
}

/* ─── Generic EmptyState ─── */

type EmptyStateProps = {
  illustration: ReactNode
  title: string
  description?: string
  children?: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export const EmptyState = memo(function EmptyState({
  illustration,
  title,
  description,
  children,
  className,
  size = 'md',
}: EmptyStateProps) {
  const sizeCls = {
    sm: { box: 'h-16 w-16', title: 'text-base', desc: 'text-xs' },
    md: { box: 'h-24 w-24', title: 'text-lg', desc: 'text-sm' },
    lg: { box: 'h-32 w-32', title: 'text-xl', desc: 'text-sm' },
  }[size]

  return (
    <div



      className={cn('flex flex-col items-center justify-center text-center px-6 py-10', className)}
    >
      {/* Floating illustration */}
      <div



        className="relative"
      >
        <div


          className={cn(
            'relative rounded-3xl bg-linear-to-br from-blue-50 to-blue-50 inline-flex items-center justify-center ring-4 ring-blue-100/40 ',
            sizeCls.box
          )}
        >
          {illustration}
        </div>
      </div>

      <h3



        className={cn('font-bold mt-5 text-foreground', sizeCls.title)}
      >
        {title}
      </h3>

      {description && (
        <p



          className={cn('text-muted-foreground mt-1.5 max-w-md leading-relaxed', sizeCls.desc)}
        >
          {description}
        </p>
      )}

      {children && (
        <div



          className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          {children}
        </div>
      )}
    </div>
  )
})

/* ─── Specific Empty State Variants ─── */

export const NoResultsFound = memo(function NoResultsFound({
  onReset,
  onExplore,
  className,
}: {
  onReset?: () => void
  onExplore?: () => void
  className?: string
}) {
  return (
    <EmptyState
      illustration={<MagnifyingGlassSVG />}
      title="Không tìm thấy chuyến"
      description="Thử đổi ngày đi, chọn thành phố lân cận hoặc bỏ bớt bộ lọc loại xe để có thêm lựa chọn phù hợp."
      className={className}
    >
      {onReset && (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onReset}>
          Xoá bộ lọc
        </Button>
      )}
      {onExplore && (
        <Button
          size="sm"
          className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
          onClick={onExplore}
        >
          Khám phá tuyến phổ biến
        </Button>
      )}
    </EmptyState>
  )
})

export const NoBookingsYet = memo(function NoBookingsYet({
  onSearch,
  className,
}: {
  onSearch?: () => void
  className?: string
}) {
  return (
    <EmptyState
      illustration={<TicketSVG />}
      title="Chưa có vé nào"
      description="Bạn chưa đặt chuyến nào. Tìm chuyến xe phù hợp và đặt vé ngay hôm nay để bắt đầu hành trình của mình."
      className={className}
      size="lg"
    >
      {onSearch && (
        <Button
          size="sm"
          className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
          onClick={onSearch}
        >
          Đặt chuyến đầu tiên
        </Button>
      )}
    </EmptyState>
  )
})

export const NoWishlistItems = memo(function NoWishlistItems({
  onExplore,
  className,
}: {
  onExplore?: () => void
  className?: string
}) {
  return (
    <EmptyState
      illustration={<HeartSVG />}
      title="Danh sách yêu thích trống"
      description="Lưu các tuyến đường bạn thường đi để đặt vé nhanh lần sau. Nhấn vào biểu tượng trái tim trên thẻ chuyến để thêm."
      className={className}
    >
      {onExplore && (
        <Button
          size="sm"
          className="gap-1.5 bg-linear-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white"
          onClick={onExplore}
        >
          Khám phá chuyến đi
        </Button>
      )}
    </EmptyState>
  )
})

export const NoNotifications = memo(function NoNotifications({ className }: { className?: string }) {
  return (
    <EmptyState
      illustration={<BellSVG />}
      title="Chưa có thông báo"
      description="Thông báo đặt vé, khuyến mãi và nhắc chuyến đi sẽ xuất hiện tại đây."
      className={className}
      size="sm"
    />
  )
})

export const NoReviewsYet = memo(function NoReviewsYet({
  onWrite,
  className,
}: {
  onWrite?: () => void
  className?: string
}) {
  return (
    <EmptyState
      illustration={<StarSVG />}
      title="Chưa có đánh giá"
      description="Hãy là người đầu tiên chia sẻ trải nghiệm chuyến đi của bạn."
      className={className}
      size="sm"
    >
      {onWrite && (
        <Button
          size="sm"
          className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
          onClick={onWrite}
        >
          Viết đánh giá đầu tiên
        </Button>
      )}
    </EmptyState>
  )
})

export const ErrorState = memo(function ErrorState({
  onRetry,
  description = 'Đã có lỗi xảy ra trong quá trình tải dữ liệu. Vui lòng thử lại.',
  className,
}: {
  onRetry?: () => void
  description?: string
  className?: string
}) {
  return (
    <EmptyState
      illustration={<WarningSVG />}
      title="Đã có lỗi xảy ra"
      description={description}
      className={className}
    >
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
          onClick={onRetry}
        >
          Thử lại
        </Button>
      )}
    </EmptyState>
  )
})
