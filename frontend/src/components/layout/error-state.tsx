'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/layout/empty-state'

/* ─── SVG Illustrations (line-art style with teal accents) ─── */

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
