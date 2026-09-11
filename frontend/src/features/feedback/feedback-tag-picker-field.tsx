'use client'

/**
 * FeedbackTagPickerField — the "Điểm nổi bật" chip picker of the
 * feedback form (multi-select, derived from the shared
 * REVIEW_TAG_LABELS index).
 *
 * Extracted from the original `feedback-form.tsx`.
 */

import type { UseFormReturn } from 'react-hook-form'
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { REVIEW_TAG_LABELS } from '@/features/booking/history/booking-types'
import type { FeedbackValues } from './feedback-schema'

const TAG_OPTIONS = Object.entries(REVIEW_TAG_LABELS).map(([key, v]) => ({
  key,
  label: v.label,
  emoji: v.emoji,
}))

export function FeedbackTagPickerField({
  form,
}: {
  form: UseFormReturn<FeedbackValues>
}) {
  return (
            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Điểm nổi bật (chọn nhiều)
                  </FormLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {TAG_OPTIONS.map((t) => {
                      const active = (field.value ?? []).includes(t.key)
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() =>
                            field.onChange(
                              (field.value ?? []).includes(t.key)
                                ? (field.value ?? []).filter((k) => k !== t.key)
                                : [...(field.value ?? []), t.key],
                            )
                          }
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${active
                            ? 'bg-amber-500 text-white scale-105'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                        >
                          <span>{t.emoji}</span>
                          {t.label}
                        </button>
                      )
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
  )
}
