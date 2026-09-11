'use client'

/**
 * ShareDialog — the trip sharing dialog.
 *
 * Top-level orchestrator. Owns the dialog state (`shareOpen`,
 * `shareTripData` from the app store), the copied-link feedback state
 * and the channel handlers (copy / download / Facebook / Zalo /
 * WhatsApp).
 *
 * Rendering is delegated to dedicated sub-components under `trips/`:
 *   - ShareTripCard      — the trip-card preview
 *   - ShareActionGrid    — copy/download/channel buttons
 *   - ShareEmailForm     — the mailto: share form (own form state)
 *
 * The PNG card exporter lives in `share-image.ts`, the shareable-code
 * generator + shared types in `share-helpers.ts`.
 */

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { formatCurrency, EXCHANGE_RATE } from '@/lib/currency'
import { Share2, Phone } from 'lucide-react'
import { toast } from 'sonner'
import { buildShareUrl } from './share-helpers'
import { downloadTripImage } from './share-image'
import { ShareTripCard } from './share-trip-card'
import { ShareActionGrid } from './share-action-grid'
import { ShareEmailForm } from './share-email-form'

export function ShareDialog() {
  const { shareOpen, setShareOpen, shareTripData, setShareTripData, currency } = useApp()
  const [copied, setCopied] = useState(false)

  // Reset copied state when dialog toggles
  useEffect(() => {
    if (!shareOpen) {
      const t = setTimeout(() => setCopied(false), 200)
      return () => clearTimeout(t)
    }
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
        : 'DatXeVui — Đặt vé xe online',
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
        : 'DatXeVui',
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
            <ShareTripCard shareTripData={shareTripData} shareInfo={shareInfo} currency={currency} />

            {/* Action grid */}
            <ShareActionGrid
              copied={copied}
              handleCopy={handleCopy}
              handleDownload={handleDownload}
              handleFacebook={handleFacebook}
              handleZalo={handleZalo}
              handleWhatsApp={handleWhatsApp}
            />

            {/* Email share form */}
            <ShareEmailForm
              shareOpen={shareOpen}
              shareTripData={shareTripData}
              shareInfo={shareInfo}
              currency={currency}
            />

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
