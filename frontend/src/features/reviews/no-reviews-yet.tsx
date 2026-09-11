'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/layout/empty-state'

/* ─── SVG Illustrations (line-art style with teal accents) ─── */

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
