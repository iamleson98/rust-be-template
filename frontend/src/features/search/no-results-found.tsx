'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/layout/empty-state'

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
