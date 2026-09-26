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
import { useT } from '@/lib/i18n'
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
  const t = useT()
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
      toast.error(t('trips.noTripToShare'))
      return
    }
    setSendingEmail(true)
    try {
      const subject = `DatXeVui — ${shareTripData.fromName} → ${shareTripData.toName} · ${shareTripData.brandName}`
      const departureInfo = `${shareTripData.departureTime || (shareTripData.departureAt ? formatTimeVN(shareTripData.departureAt) : '')}${shareTripData.departureAt ? ' — ' + formatDateVN(shareTripData.departureAt, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : ''}`
      const defaultBody = [
        t('trips.emailGreeting'),
        '',
        t('trips.emailIntro'),
        '',
        t('trips.emailRoute', { from: shareTripData.fromName, to: shareTripData.toName }),
        t('trips.emailBrand', { brand: shareTripData.brandName }),
        t('trips.emailDeparture', { time: departureInfo }),
        t('trips.emailPrice', { price: formatCurrency(shareTripData.minPrice, currency) }),
        '',
        t('trips.emailBookingUrl', { url: shareInfo.url }),
        '',
        t('trips.emailFooter'),
      ].join('\n')
      const body = values.message?.trim() ? `${values.message.trim()}\n\n${defaultBody}` : defaultBody
      const mailto = `mailto:${values.recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      // Open the user's email client. We do NOT POST to any backend —
      // mailto: is the cross-browser "share via email" primitive.
      // Navigating away via mailto: — an event-time side effect on a
      // global. The react-hooks/immutability rule cannot prove this
      // runs only from the submit handler, hence the targeted disable.
      // eslint-disable-next-line react-hooks/immutability
      window.location.href = mailto
      toast.success(t('trips.emailClientOpened', { email: values.recipientEmail }), {
        description: t('trips.emailComposeHint'),
      })
    } catch {
      toast.error(t('trips.emailOpenFailed'))
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
                  {t('trips.emailSection')}
                </div>
                <FormField
                  control={form.control}
                  name="recipientEmail"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-xs font-medium text-foreground">
                        {t('trips.emailRecipient')} <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          placeholder={t('trips.emailRecipientPh')}
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
                        {t('trips.emailMessageLabel')}
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={field.value ?? ''}
                          placeholder={t('trips.emailMessagePh')}
                          rows={3}
                          maxLength={500}
                          className="resize-none"
                        />
                      </FormControl>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{t('trips.emailMaxChars')}</span>
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
                      {t('trips.emailOpening')}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t('trips.emailSend')}
                    </>
                  )}
                </Button>
              </form>
            </Form>
  )
}
