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
import { useUi } from '@/stores/ui'
import { usePrefs } from '@/stores/prefs'
import { useT } from '@/lib/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { formatCurrency, EXCHANGE_RATE } from '@/lib/format'
import { Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { buildShareUrl } from './helpers'
import { downloadTripImage } from './image'
import { ShareTripCard } from './trip-card'
import { ShareActionGrid } from './action-grid'
import { ShareEmailForm } from './email-form'

export function ShareDialog() {
  const shareTripData = useUi((s) => s.shareTrip)
  const close = useUi((s) => s.closeShare)
  const currency = usePrefs((s) => s.currency)
  const shareOpen = !!shareTripData
  const t = useT()
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

  const handleCopy = async () => {
    if (!shareInfo) return
    try {
      await navigator.clipboard.writeText(shareInfo.url)
      setCopied(true)
      toast.success(t('trips.linkCopied'), { description: shareInfo.url })
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
        toast.success(t('trips.linkCopied'), { description: shareInfo.url })
        setTimeout(() => setCopied(false), 1800)
      } catch {
        toast.error(t('trips.copyFailedManual'))
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
        ? t('trips.shareQuote', {
            from: shareTripData.fromName,
            to: shareTripData.toName,
            price: formatCurrency(shareTripData.minPrice, currency),
            brand: shareTripData.brandName,
          })
        : t('trips.shareFallbackQuote'),
    )
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${quote}`,
      '_blank',
      'noopener,noreferrer,width=640,height=540',
    )
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
    window.open(
      `https://zalo.me/share?url=${u}&title=${desc}`,
      '_blank',
      'noopener,noreferrer,width=640,height=540',
    )
  }

  const handleWhatsApp = () => {
    if (!shareInfo || !shareTripData) return
    const text = encodeURIComponent(
      t('trips.shareQuoteWa', {
        from: shareTripData.fromName,
        to: shareTripData.toName,
        brand: shareTripData.brandName,
        price: formatCurrency(shareTripData.minPrice, currency),
        url: shareInfo.url,
      }),
    )
    window.open(
      `https://api.whatsapp.com/send?text=${text}`,
      '_blank',
      'noopener,noreferrer,width=640,height=540',
    )
  }

  return (
    <Dialog open={shareOpen} onOpenChange={(o) => !o && close()}>
      {/* The header stays put; the body scrolls (the email form is long on phones). */}
      <DialogContent className="flex w-[95vw] max-w-md flex-col gap-0 overflow-hidden p-0 max-sm:p-0">
        <DialogHeader icon={<Share2 />} className="shrink-0 border-b px-5 py-4 pr-14">
          <DialogTitle>{t('trips.shareTrip')}</DialogTitle>
          <DialogDescription>{t('trips.shareTripDesc')}</DialogDescription>
        </DialogHeader>

        {shareTripData && shareInfo && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {/* Trip Card Preview */}
            <ShareTripCard
              shareTripData={shareTripData}
              shareInfo={shareInfo}
              currency={currency}
            />

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

            {/* Exchange rate note (contact info lives in the site
                footer — no hotline repetition here) */}
            <div className="text-center text-[11px] text-muted-foreground">
              {t('trips.shareRateNote', { rate: EXCHANGE_RATE.toLocaleString('vi-VN') })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
