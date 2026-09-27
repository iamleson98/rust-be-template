/**
 * Pure helpers for the AdminDashboard module.
 *
 *   - downloadCSV: triggers a browser-side file download for the CSV text
 *     returned by `/api/admin/bookings/export`.
 *   - formatVNDShort / formatVNDMillions: compact VND labels for chart
 *     cards.
 */

/** Triggers a browser-side file download for the given text content. */
export function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ── Compact VND formatters for the dashboard chart cards ────────
 * Extracted from the original 'stats-overview.tsx'. */

export function formatVNDShort(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ₫`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} triệu₫`
  return new Intl.NumberFormat('vi-VN').format(n) + '₫'
}

export function formatVNDMillions(n: number | null | undefined): string {
  if (n == null) return '0'
  return (n / 1_000_000).toFixed(1)
}
