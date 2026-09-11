'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/layout/empty-state'

/* ─── SVG Illustrations (line-art style with teal accents) ─── */

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
