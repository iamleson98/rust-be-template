'use client'

/**
 * Tiny colored dot for a brand's accent color — shared by the admin
 * schedules + routes pages (extracted from their original inline copies).
 */

export function BrandDot({ color }: { color?: string | null }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: color ?? '#94a3b8' }}
    />
  )
}
