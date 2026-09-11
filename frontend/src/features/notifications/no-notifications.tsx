'use client'

import { memo } from 'react'
import { EmptyState } from '@/components/layout/empty-state'

/* ─── SVG Illustrations (line-art style with teal accents) ─── */

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
