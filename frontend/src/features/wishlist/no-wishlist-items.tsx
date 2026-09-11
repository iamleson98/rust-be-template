'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/layout/empty-state'

/* ─── SVG Illustrations (line-art style with teal accents) ─── */

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
