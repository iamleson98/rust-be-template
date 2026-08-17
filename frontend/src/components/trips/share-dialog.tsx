'use client'

import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useApp } from '@/lib/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { emailSchema, optionalText } from '@/lib/forms'
import { formatCurrency, EXCHANGE_RATE } from '@/lib/currency'
import { formatDateVN, formatTimeVN } from '@/lib/types'
import {
  Bus,
  Star,
  Navigation,
  Clock,
  Calendar,
  Copy,
  Check,
  Download,
  Facebook,
  MessageCircle,
  Phone,
  Share2,
  Armchair,
  Sparkles,
  Mail,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'

/* WhatsApp icon (lucide-react doesn't ship one) */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.607zm5.49-7.781c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  )
}

/**
 * Generate a deterministic shareable code + URL from a trip id.
 * Not a real URL — just for the demo copy-to-clipboard action.
 */
function buildShareUrl(tripId: string): { code: string; url: string } {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let hash = 0
  for (let i = 0; i < tripId.length; i++) {
    hash = ((hash << 5) - hash + tripId.charCodeAt(i)) | 0
  }
  const seed = Math.abs(hash)
  let code = 'PT-'
  for (let i = 0; i < 6; i++) {
    code += chars[(seed + i * 31) % chars.length]
  }
  return { code, url: `https://vexevn.vn/s/${code}` }
}

/**
 * Render the trip card preview onto a canvas and download as PNG.
 * Uses standard 2D canvas API (no external libs).
 */
function downloadTripImage(trip: NonNullable<ReturnType<typeof useApp.getState>['shareTripData']>) {
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
  ctx.fillText('VeXeVN', cardX + 40, cardY + 55)
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
  ctx.fillText('Truy cập vexevn.vn để đặt vé ngay', W / 2, H - 36)
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

/**
 * Email-share schema.
 *   - recipientEmail: required, must be a valid email (uses shared emailSchema)
 *   - message: optional, ≤500 chars (uses shared optionalText helper)
 */
const shareEmailSchema = z.object({
  recipientEmail: emailSchema,
  message: optionalText(500),
})

type ShareEmailValues = z.infer<typeof shareEmailSchema>

export function ShareDialog() {
  const { shareOpen, setShareOpen, shareTripData, setShareTripData, currency } = useApp()
  const [copied, setCopied] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)

  const form = useForm<ShareEmailValues>({
    resolver: zodResolver(shareEmailSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      recipientEmail: '',
      message: '',
    },
  })

  // Reset copied state when dialog toggles
  useEffect(() => {
    if (!shareOpen) {
      const t = setTimeout(() => setCopied(false), 200)
      return () => clearTimeout(t)
    }
  }, [shareOpen])

  // Reset email form when dialog closes
  useEffect(() => {
    if (!shareOpen) {
      const t = setTimeout(() => {
        form.reset({ recipientEmail: '', message: '' })
        setSendingEmail(false)
      }, 250)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareOpen])

  const shareInfo = useMemo(() => {
    if (!shareTripData) return null
    return buildShareUrl(shareTripData.tripId)
  }, [shareTripData])

  const close = () => {
    setShareOpen(false)
    // Clear share data shortly after to allow exit animation
    setTimeout(() => setShareTripData(null), 250)
  }

  const handleCopy = async () => {
    if (!shareInfo) return
    try {
      await navigator.clipboard.writeText(shareInfo.url)
      setCopied(true)
      toast.success('Đã sao chép link chia sẻ', { description: shareInfo.url })
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea')
      ta.value = shareInfo.url
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        toast.success('Đã sao chép link chia sẻ', { description: shareInfo.url })
        setTimeout(() => setCopied(false), 1800)
      } catch {
        toast.error('Không thể sao chép. Vui lòng copy thủ công.')
      } finally {
        document.body.removeChild(ta)
      }
    }
  }

  const handleDownload = () => {
    if (!shareTripData) return
    downloadTripImage(shareTripData)
  }

  const handleFacebook = () => {
    if (!shareInfo) return
    const u = encodeURIComponent(shareInfo.url)
    const quote = encodeURIComponent(
      shareTripData
        ? `${shareTripData.fromName} → ${shareTripData.toName} chỉ từ ${formatCurrency(shareTripData.minPrice, currency)} — ${shareTripData.brandName}`
        : 'VeXeVN — Đặt vé xe online',
    )
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${quote}`, '_blank', 'noopener,noreferrer,width=640,height=540')
  }

  const handleZalo = () => {
    if (!shareInfo) return
    // Zalo share URL (official OA share endpoint)
    const u = encodeURIComponent(shareInfo.url)
    const desc = encodeURIComponent(
      shareTripData
        ? `${shareTripData.fromName} → ${shareTripData.toName} • ${shareTripData.brandName}`
        : 'VeXeVN',
    )
    window.open(`https://zalo.me/share?url=${u}&title=${desc}`, '_blank', 'noopener,noreferrer,width=640,height=540')
  }

  const handleWhatsApp = () => {
    if (!shareInfo || !shareTripData) return
    const text = encodeURIComponent(
      `${shareTripData.fromName} → ${shareTripData.toName} • ${shareTripData.brandName} — chỉ từ ${formatCurrency(shareTripData.minPrice, currency)}. Đặt vé tại ${shareInfo.url}`,
    )
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank', 'noopener,noreferrer,width=640,height=540')
  }

  const onSendEmail = async (values: ShareEmailValues) => {
    if (!shareInfo || !shareTripData) {
      toast.error('Không có thông tin chuyến đi để chia sẻ')
      return
    }
    setSendingEmail(true)
    try {
      const subject = `VeXeVN — ${shareTripData.fromName} → ${shareTripData.toName} · ${shareTripData.brandName}`
      const defaultBody = `Chào bạn,

Tôi muốn chia sẻ chuyến đi trên VeXeVN:

• Tuyến: ${shareTripData.fromName} → ${shareTripData.toName}
• Hãng xe: ${shareTripData.brandName}
• Khởi hành: ${shareTripData.departureTime || (shareTripData.departureAt ? formatTimeVN(shareTripData.departureAt) : '')}${shareTripData.departureAt ? ' — ' + formatDateVN(shareTripData.departureAt, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : ''}
• Giá từ: ${formatCurrency(shareTripData.minPrice, currency)}

Đặt vé tại: ${shareInfo.url}

VeXeVN — Đặt vé xe khách online.`
      const body = values.message?.trim() ? `${values.message.trim()}\n\n${defaultBody}` : defaultBody
      const mailto = `mailto:${values.recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      // Open the user's email client. We do NOT POST to any backend —
      // mailto: is the cross-browser "share via email" primitive.
      window.location.href = mailto
      toast.success(`Đã mở ứng dụng email cho ${values.recipientEmail}`, {
        description: 'Hoàn tất soạn thư trong trình email của bạn',
      })
    } catch {
      toast.error('Không thể mở ứng dụng email')
    } finally {
      setSendingEmail(false)
    }
  }

  return (
    <Dialog open={shareOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md w-[95vw] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b bg-linear-to-r from-blue-50 to-blue-50">
          <DialogTitle className="text-base font-extrabold flex items-center gap-2">
            <Share2 className="h-4 w-4 text-blue-600" />
            Chia sẻ chuyến đi
          </DialogTitle>
          <DialogDescription className="text-xs">
            Gửi chuyến đi này cho bạn bè hoặc người thân
          </DialogDescription>
        </DialogHeader>

        {shareTripData && shareInfo && (
          <div className="p-5 space-y-4">
            {/* Trip Card Preview */}
            <div
              className="relative rounded-2xl overflow-hidden"
            >
              {/* Gradient background */}
              <div className="bg-linear-to-br from-blue-600 via-blue-500 to-blue-600 p-5 text-white relative">
                {/* Decorative circles */}
                <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-white/10" />
                <div className="absolute -bottom-16 -left-12 h-44 w-44 rounded-full bg-white/10" />

                {/* Brand strip */}
                <div className="flex items-center gap-2 mb-3 relative z-10">
                  <div className="h-7 w-7 rounded-lg bg-white/20 flex items-center justify-center">
                    <Bus className="h-4 w-4" />
                  </div>
                  <div className="text-sm font-extrabold tracking-wide">VeXeVN</div>
                  <span className="text-[10px] text-white/80 ml-auto">Đặt vé xe online</span>
                </div>

                {/* White card */}
                <div className="bg-white rounded-xl overflow-hidden relative z-10">
                  {/* Top accent stripe */}
                  <div
                    className="h-1.5"
                    style={{ background: shareTripData.brandAccent || '#2563eb' }}
                  />
                  <div className="p-4">
                    {/* Brand + rating */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-bold text-slate-900 text-sm truncate flex-1">
                        {shareTripData.brandName}
                      </div>
                      {shareTripData.brandRating && (
                        <Badge variant="outline" className="text-[10px] gap-0.5 border-amber-300 text-amber-700 font-semibold">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {shareTripData.brandRating.toFixed(1)}
                        </Badge>
                      )}
                    </div>

                    {/* Route */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className="font-extrabold text-slate-900 text-base truncate flex-1">
                        {shareTripData.fromName}
                      </div>
                      <div className="shrink-0 h-7 w-7 rounded-full bg-blue-50 flex items-center justify-center">
                        <Navigation className="h-3.5 w-3.5 text-blue-600" />
                      </div>
                      <div className="font-extrabold text-slate-900 text-base truncate flex-1 text-right">
                        {shareTripData.toName}
                      </div>
                    </div>

                    {/* Departure + vehicle type */}
                    <div className="grid grid-cols-2 gap-3 text-xs mb-3 pb-3 border-b border-dashed">
                      <div>
                        <div className="text-muted-foreground uppercase tracking-wide text-[9px]">Khởi hành</div>
                        <div className="font-semibold text-slate-900 flex items-center gap-1">
                          <Clock className="h-3 w-3 text-blue-600" />
                          {shareTripData.departureTime || (shareTripData.departureAt ? formatTimeVN(shareTripData.departureAt) : '')}
                        </div>
                        {shareTripData.departureAt && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-2.5 w-2.5" />
                            {formatDateVN(shareTripData.departureAt, { day: '2-digit', month: '2-digit', year: '2-digit' })}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-muted-foreground uppercase tracking-wide text-[9px]">Loại xe</div>
                        <div className="font-semibold text-slate-900 flex items-center gap-1">
                          <Armchair className="h-3 w-3 text-blue-600" />
                          {shareTripData.vehicleTypeLabel || 'Xe khách'}
                        </div>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="rounded-lg bg-blue-50 p-3 flex items-end justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-blue-700 font-semibold">Giá từ</div>
                        <div className="text-2xl font-extrabold text-blue-700 leading-none">
                          {formatCurrency(shareTripData.minPrice, currency)}
                        </div>
                      </div>
                      <Badge className="bg-amber-100 text-amber-800 border-0 gap-0.5 text-[10px]">
                        <Sparkles className="h-3 w-3" />
                        Ưu đãi hôm nay
                      </Badge>
                    </div>

                    {/* Share code + URL */}
                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Mã: <span className="font-mono font-bold text-blue-700">{shareInfo.code}</span></span>
                      <span className="truncate ml-2">{shareInfo.url}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action grid */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={handleCopy}
                variant="outline"
                className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                {copied ? <Check className="h-4 w-4 text-blue-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Đã copy' : 'Sao chép link'}
              </Button>
              <Button
                onClick={handleDownload}
                variant="outline"
                className="gap-2 border-amber-300 text-violet-700 hover:bg-violet-50"
              >
                <Download className="h-4 w-4" />
                Tải ảnh
              </Button>
              <Button
                onClick={handleFacebook}
                variant="outline"
                className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <Facebook className="h-4 w-4" />
                Facebook
              </Button>
              <Button
                onClick={handleZalo}
                variant="outline"
                className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <MessageCircle className="h-4 w-4" />
                Zalo
              </Button>
              <Button
                onClick={handleWhatsApp}
                variant="outline"
                className="gap-2 col-span-2 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <WhatsAppIcon className="h-4 w-4" />
                Chia sẻ WhatsApp
              </Button>
            </div>

            {/* Email share form */}
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSendEmail)}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 text-blue-600" />
                  Gửi qua email
                </div>
                <FormField
                  control={form.control}
                  name="recipientEmail"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-xs font-medium text-foreground">
                        Email người nhận <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          placeholder="vd: banbe@example.com"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-xs font-medium text-foreground">
                        Lời nhắn (tuỳ chọn)
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={field.value ?? ''}
                          placeholder="VD: Đây là chuyến đi mình vừa đặt, bạn tham khảo nhé!"
                          rows={3}
                          maxLength={500}
                          className="resize-none"
                        />
                      </FormControl>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Tối đa 500 ký tự</span>
                        <span>{(field.value ?? '').length}/500</span>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  disabled={sendingEmail}
                  className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {sendingEmail ? (
                    <>
                      <Check className="h-4 w-4 animate-pulse" />
                      Đang mở...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Gửi email
                    </>
                  )}
                </Button>
              </form>
            </Form>

            {/* Exchange rate note */}
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground pt-1">
              <Phone className="h-3 w-3" />
              Hotline 1900 6067 · Tỷ giá: 1 USD = {EXCHANGE_RATE.toLocaleString('vi-VN')}₫
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
