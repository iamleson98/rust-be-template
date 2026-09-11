/**
 * Share-image exporter — renders the trip card preview onto a canvas
 * and downloads it as PNG (standard 2D canvas API, no external libs).
 *
 * Extracted from the original `share-dialog.tsx`.
 */

import { toast } from 'sonner'
import { formatCurrency } from '@/lib/currency'
import { formatDateVN, formatTimeVN } from '@/lib/types'
import { buildShareUrl } from './share-helpers'
import type { useApp } from '@/lib/store'

/**
 * Render the trip card preview onto a canvas and download as PNG.
 * Uses standard 2D canvas API (no external libs).
 */
export function downloadTripImage(trip: NonNullable<ReturnType<typeof useApp.getState>['shareTripData']>) {
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    toast.error('Trình duyệt không hỗ trợ tải ảnh')
    return
  }

  // Background gradient (teal → emerald)
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#2563eb')
  bg.addColorStop(0.5, '#2563eb')
  bg.addColorStop(1, '#059669')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Decorative circles
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.beginPath()
  ctx.arc(W - 100, 200, 280, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(80, H - 80, 220, 0, Math.PI * 2)
  ctx.fill()

  // White card
  const cardX = 80
  const cardY = 280
  const cardW = W - 160
  const cardH = H - cardY - 80
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, cardX, cardY, cardW, cardH, 32)
  ctx.fill()

  // Logo band at top of card
  ctx.fillStyle = '#2563eb'
  roundRectTop(ctx, cardX, cardY, cardW, 110, 32)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 42px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('DatXeVui', cardX + 40, cardY + 55)
  ctx.font = '20px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText('Đặt vé xe khách online', cardX + 240, cardY + 58)

  // Brand accent stripe
  const accent = trip.brandAccent || '#2563eb'
  ctx.fillStyle = accent
  ctx.fillRect(cardX, cardY + 110, 12, cardH - 110)

  // Brand name + rating
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 38px sans-serif'
  ctx.fillText(trip.brandName.slice(0, 32), cardX + 60, cardY + 180)

  if (trip.brandRating) {
    ctx.fillStyle = '#f59e0b'
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText('★', cardX + 60, cardY + 240)
    ctx.fillStyle = '#475569'
    ctx.font = '26px sans-serif'
    ctx.fillText(`${trip.brandRating.toFixed(1)} / 5.0`, cardX + 100, cardY + 240)
  }

  // Route (from → to)
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 56px sans-serif'
  const fromShort = trip.fromName.length > 16 ? trip.fromName.slice(0, 14) + '…' : trip.fromName
  const toShort = trip.toName.length > 16 ? trip.toName.slice(0, 14) + '…' : trip.toName
  ctx.fillText(fromShort, cardX + 60, cardY + 340)
  ctx.fillStyle = '#2563eb'
  ctx.font = 'bold 44px sans-serif'
  ctx.fillText('→', cardX + 60 + ctx.measureText(fromShort).width + 16, cardY + 340)
  ctx.fillStyle = '#0f172a'
  ctx.fillText(toShort, cardX + 60 + ctx.measureText(fromShort).width + 80, cardY + 340)

  // Divider
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cardX + 60, cardY + 400)
  ctx.lineTo(cardX + cardW - 60, cardY + 400)
  ctx.stroke()

  // Departure info
  let depTime = trip.departureTime || ''
  if (!depTime && trip.departureAt) {
    depTime = formatTimeVN(trip.departureAt)
  }
  const depDate = trip.departureAt ? formatDateVN(trip.departureAt, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
  ctx.fillStyle = '#64748b'
  ctx.font = '22px sans-serif'
  ctx.fillText('KHỞI HÀNH', cardX + 60, cardY + 460)
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 38px sans-serif'
  ctx.fillText(depTime, cardX + 60, cardY + 500)
  ctx.fillStyle = '#64748b'
  ctx.font = '22px sans-serif'
  ctx.fillText(depDate, cardX + 60, cardY + 540)

  // Vehicle type (right column)
  if (trip.vehicleTypeLabel) {
    ctx.fillStyle = '#64748b'
    ctx.font = '22px sans-serif'
    ctx.fillText('LOẠI XE', cardX + cardW - 360, cardY + 460)
    ctx.fillStyle = '#0f172a'
    ctx.font = 'bold 32px sans-serif'
    ctx.fillText(trip.vehicleTypeLabel.slice(0, 22), cardX + cardW - 360, cardY + 500)
  }

  // Divider
  ctx.beginPath()
  ctx.moveTo(cardX + 60, cardY + 600)
  ctx.lineTo(cardX + cardW - 60, cardY + 600)
  ctx.stroke()

  // Price block (highlighted)
  const priceBoxY = cardY + 660
  const priceBoxH = 200
  ctx.fillStyle = '#f0fdfa'
  roundRect(ctx, cardX + 60, priceBoxY, cardW - 120, priceBoxH, 24)
  ctx.fill()
  ctx.fillStyle = '#64748b'
  ctx.font = '24px sans-serif'
  ctx.fillText('GIÁ TỪ', cardX + 100, priceBoxY + 60)
  ctx.fillStyle = '#2563eb'
  ctx.font = 'bold 88px sans-serif'
  const priceStr = formatCurrency(trip.minPrice, 'VND')
  ctx.fillText(priceStr, cardX + 100, priceBoxY + 140)

  // Share code
  const { code, url } = buildShareUrl(trip.tripId)
  ctx.fillStyle = '#64748b'
  ctx.font = '20px sans-serif'
  ctx.fillText('Mã chia sẻ:', cardX + 60, cardY + cardH - 90)
  ctx.fillStyle = '#2563eb'
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText(code, cardX + 200, cardY + cardH - 90)
  ctx.fillStyle = '#94a3b8'
  ctx.font = '18px sans-serif'
  ctx.fillText(url, cardX + 60, cardY + cardH - 50)

  // Footer text on the gradient bg
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = '24px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Truy cập datxevui.vn để đặt vé ngay', W / 2, H - 36)
  ctx.textAlign = 'left'

  // Download
  const filename = `vexevn-trip-${code}.png`
  canvas.toBlob((blob) => {
    if (!blob) {
      toast.error('Không thể tạo ảnh')
      return
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
    toast.success('Đã tải ảnh chuyến đi', { description: filename })
  }, 'image/png')
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function roundRectTop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
