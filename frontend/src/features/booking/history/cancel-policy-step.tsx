'use client'

// Extracted from the original 'cancel-dialog.tsx'.

import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@/lib/i18n'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { AlertTriangle, ShieldCheck, Clock } from 'lucide-react'
import {
  FormField,
  FormItem,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { type CancelValues } from './cancel-dialog-schema'

export function CancelPolicyStep({
  form,
}: {
  form: UseFormReturn<CancelValues>
}) {
  const t = useT()

  return (
    <div key="step2" className="space-y-4 py-2">
      {/* Warning banner */}
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">{t('cancel.confirmWarning')}</div>
      </div>

      {/* Refund policy */}
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          {t('cancel.refundPolicy')}
        </div>
        <Separator />
        <div className="space-y-2.5">
          <div className="flex items-start gap-2.5 text-sm">
            <Clock className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <span className="text-foreground">{t('cancel.refundFull')}</span>
          </div>
          <div className="flex items-start gap-2.5 text-sm">
            <Clock className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <span className="text-foreground">{t('cancel.refundHalf')}</span>
          </div>
          <div className="flex items-start gap-2.5 text-sm">
            <Clock className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
            <span className="text-foreground">{t('cancel.refundNone')}</span>
          </div>
        </div>
      </div>

      {/* Agreement checkbox */}
      <FormField
        control={form.control}
        name="agreed"
        render={({ field }) => (
          <FormItem>
            <label className="flex items-start gap-3 cursor-pointer group">
              <FormControl>
                <Checkbox
                  checked={!!field.value}
                  onCheckedChange={(v) => {
                    field.onChange(!!v)
                    if (v) form.clearErrors('agreed')
                  }}
                  className="mt-0.5 data-[state=checked]:bg-rose-500 data-[state=checked]:border-rose-500"
                />
              </FormControl>
              <span className="text-sm text-foreground group-hover:text-rose-700 transition-colors">
                {t('cancel.agree')}
              </span>
            </label>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
