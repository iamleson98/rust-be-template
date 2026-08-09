/**
 * Pure helpers for the AdminDashboard module.
 *
 * Extracted verbatim from the original `admin-dashboard.tsx`
 * (lines 229-314). Pure functions for the revenue forecast,
 * CSV export, and browser-side file download.
 */

import type { RecentBooking } from './types'

/**
 * Simple linear-regression forecast with a widening confidence band.
 * Used by the "Dự báo doanh thu 7 ngày tới" chart.
 */
export function simpleLinearForecast(values: number[], steps = 7): { forecast: number[]; lower: number[]; upper: number[] } {
  // Linear regression: y = a + b*x
  const n = values.length
  const xs = Array.from({ length: n }, (_, i) => i)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = values.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  const b = den === 0 ? 0 : num / den
  const a = meanY - b * meanX
  // Residual std for confidence band
  const residuals = values.map((y, i) => y - (a + b * xs[i]))
  const variance = residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2)
  const std = Math.sqrt(variance)
  const forecast: number[] = []
  const lower: number[] = []
  const upper: number[] = []
  for (let s = 1; s <= steps; s++) {
    const x = n - 1 + s
    const y = a + b * x
    forecast.push(Number(Math.max(0, y).toFixed(2)))
    // widening band: 1.5*std for first step, growing by 0.4*std per step
    const band = 1.5 * std + 0.4 * std * s
    lower.push(Number(Math.max(0, y - band).toFixed(2)))
    upper.push(Number((y + band).toFixed(2)))
  }
  return { forecast, lower, upper }
}

/** Builds a UTF-8 BOM-prefixed CSV string from a list of recent bookings. */
export function buildCSV(rows: RecentBooking[]): string {
  const headers = [
    'Mã vé',
    'Hành khách',
    'Điện thoại',
    'Tuyến',
    'Ngày đi',
    'Ghế',
    'Tổng tiền',
    'Trạng thái',
    'Phương thức thanh toán',
  ]
  const statusLabel: Record<string, string> = {
    confirmed: 'Đã xác nhận',
    pending: 'Chờ xử lý',
    cancelled: 'Đã huỷ',
    refunded: 'Hoàn tiền',
  }
  const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  const lines = [headers.map(escape).join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.code,
        r.name,
        r.phone,
        r.route,
        r.departDate,
        r.seat,
        String(r.price),
        statusLabel[r.status] ?? r.status,
        r.payment,
      ]
        .map(escape)
        .join(','),
    )
  }
  return '\ufeff' + lines.join('\n') // BOM for Excel UTF-8
}

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
