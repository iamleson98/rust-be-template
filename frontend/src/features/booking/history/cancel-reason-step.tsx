'use client'

// Extracted from the original 'cancel-dialog.tsx'.

import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@/lib/i18n'
import { Textarea } from '@/components/ui/textarea'
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { CANCEL_REASONS, type CancelValues } from './cancel-dialog-schema'

export function CancelReasonStep({
  form,
  selectedReason,
}: {
  form: UseFormReturn<CancelValues>
  selectedReason: string
}) {
  const t = useT()

  return (
    <div key="step1" className="space-y-3 py-2">
      <FormField
        control={form.control}
        name="selectedReason"
        render={({ field }) => (
          <FormItem className="space-y-3">
            <div className="space-y-3">
              {CANCEL_REASONS.map((reason) => (
                <button
                  key={reason.key}
                  type="button"
                  onClick={() => {
                    field.onChange(reason.key)
                    form.clearErrors('selectedReason')
                  }}
                  className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-all duration-200 flex items-center gap-3 ${
                    field.value === reason.key
                      ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-200'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div
                    className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                      field.value === reason.key
                        ? 'border-rose-500 bg-rose-500'
                        : 'border-slate-300'
                    }`}
                  >
                    {field.value === reason.key && (
                      <div className="h-2 w-2 rounded-full bg-white" />
                    )}
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      field.value === reason.key
                        ? 'text-rose-700'
                        : 'text-foreground'
                    }`}
                  >
                    {t(reason.labelKey)}
                  </span>
                </button>
              ))}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {selectedReason === 'other' && (
        <FormField
          control={form.control}
          name="otherReason"
          render={({ field }) => (
            <FormItem className="overflow-hidden">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Lý do khác <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  placeholder="Nhập lý do huỷ vé (tối thiểu 10 ký tự)..."
                  className="mt-2 resize-none"
                  rows={3}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  )
}
