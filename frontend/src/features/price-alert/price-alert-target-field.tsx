'use client'

/**
 * PriceAlertTargetField — the "Mức giá mục tiêu" input of the
 * price-alert dialog with the -10% / -20% / -30% suggestion chips
 * derived from the current minimum price.
 *
 * Extracted from the original `price-alert-dialog.tsx` — the
 * suggestedPrices computation moved along with the field.
 */

import type { PriceAlertForm } from './price-alert-schema'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { TrendingDown } from 'lucide-react'
import { formatVND } from '@/lib/types'

export function PriceAlertTargetField({
  form,
  minPrice,
  targetPrice,
}: {
  form: PriceAlertForm
  minPrice: number
  /**
   * Raw watched form value — `unknown` because the schema's
   * `z.coerce.number()` only produces a number AFTER validation;
   * the pre-submit input is still a string. Used only for chip
   * highlighting (`targetPrice === suggestion.value`), where the
   * loose type matches the original inline code exactly.
   */
  targetPrice: unknown
}) {
  const { control, setValue } = form

  const suggestedPrices = minPrice > 0
    ? [
      { pct: 10, label: '-10%', value: Math.round((minPrice * 0.9) / 1000) * 1000 },
      { pct: 20, label: '-20%', value: Math.round((minPrice * 0.8) / 1000) * 1000 },
      { pct: 30, label: '-30%', value: Math.round((minPrice * 0.7) / 1000) * 1000 },
    ]
    : []

  return (
              <FormField
                control={control}
                name="targetPrice"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel htmlFor="target-price" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Mức giá mục tiêu (VND) <span className="text-destructive">*</span>
                    </FormLabel>
                    <div className="relative">
                      <TrendingDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500 z-10" />
                      <FormControl>
                        <Input
                          id="target-price"
                          type="number"
                          inputMode="numeric"
                          min={1000}
                          step={1000}
                          value={typeof field.value === 'number' && Number.isFinite(field.value) && field.value > 0 ? field.value : ''}
                          onChange={(e) => field.onChange(Math.max(0, Math.floor(Number(e.target.value))))}
                          onBlur={field.onBlur}
                          placeholder="VD: 250000"
                          className="pl-9"
                        />
                      </FormControl>
                    </div>
                    {suggestedPrices.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[11px] text-muted-foreground mr-1">Gợi ý:</span>
                        {suggestedPrices.map((s) => (
                          <button
                            key={s.pct}
                            type="button"
                            onClick={() => setValue('targetPrice', s.value, { shouldValidate: true })}
                            className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${targetPrice === s.value
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-700'
                              }`}
                          >
                            {s.label} ({formatVND(s.value)})
                          </button>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
  )
}
