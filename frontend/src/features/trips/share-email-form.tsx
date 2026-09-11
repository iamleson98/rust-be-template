'use client'

/**
 * ShareEmailForm — the "Gửi qua email" section of the share dialog.
 *
 * Extracted from the original `share-dialog.tsx`. Owns its react-hook-form
 * instance (zod-validated), the reset-on-close effect and the mailto:
 * compose handler; the dialog passes the trip payload + share info.
 */

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { emailSchema, optionalText } from '@/lib/forms'
import { formatCurrency } from '@/lib/currency'
import { formatDateVN, formatTimeVN } from '@/lib/types'
import { Mail, Send, Check } from 'lucide-react'
import { toast } from 'sonner'
import type { ShareTripData } from './share-helpers'

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

export function ShareEmailForm({
  shareOpen,
  shareTripData,
  shareInfo,
  currency,
}: {
  shareOpen: boolean
  shareTripData: ShareTripData | null
  shareInfo: { code: string; url: string } | null
  currency: 'VND' | 'USD'
}) {
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

  const onSendEmail = async (values: ShareEmailValues) => {
    if (!shareInfo || !shareTripData) {
      toast.error('Không có thông tin chuyến đi để chia sẻ')
      return
    }
    setSendingEmail(true)
    try {
      const subject = `DatXeVui — ${shareTripData.fromName} → ${shareTripData.toName} · ${shareTripData.brandName}`
      const defaultBody = `Chào bạn,

Tôi muốn chia sẻ chuyến đi trên DatXeVui:

• Tuyến: ${shareTripData.fromName} → ${shareTripData.toName}
• Hãng xe: ${shareTripData.brandName}
• Khởi hành: ${shareTripData.departureTime || (shareTripData.departureAt ? formatTimeVN(shareTripData.departureAt) : '')}${shareTripData.departureAt ? ' — ' + formatDateVN(shareTripData.departureAt, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : ''}
• Giá từ: ${formatCurrency(shareTripData.minPrice, currency)}

Đặt vé tại: ${shareInfo.url}

DatXeVui — Đặt vé xe khách online.`
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
  )
}
