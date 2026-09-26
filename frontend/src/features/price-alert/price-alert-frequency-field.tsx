'use client'

/**
 * PriceAlertFrequencyField — the "Tần suất thông báo" radio cards of
 * the price-alert dialog (immediate / daily / weekly).
 *
 * Extracted from the original `price-alert-dialog.tsx` — the
 * FREQUENCY_OPTIONS list (icons included) moved along with the field.
 */

import type { PriceAlertForm, Frequency } from './price-alert-schema'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Clock, Calendar } from 'lucide-react'
import { useT } from '@/lib/i18n'

const FREQUENCY_OPTIONS: { value: Frequency; labelKey: string; descKey: string; icon: React.ReactNode }[] = [
  {
    value: 'immediate',
    labelKey: 'priceAlert.freqImmediate',
    descKey: 'priceAlert.freqImmediateDesc',
    icon: <Clock className="h-4 w-4" />,
  },
  {
    value: 'daily',
    labelKey: 'priceAlert.freqDaily',
    descKey: 'priceAlert.freqDailyDesc',
    icon: <Calendar className="h-4 w-4" />,
  },
  {
    value: 'weekly',
    labelKey: 'priceAlert.freqWeekly',
    descKey: 'priceAlert.freqWeeklyDesc',
    icon: <Calendar className="h-4 w-4" />,
  },
]

export function PriceAlertFrequencyField({
  form,
  frequency,
}: {
  form: PriceAlertForm
  frequency: Frequency
}) {
  const t = useT()
  const { control } = form

  return (
              <FormField
                control={control}
                name="frequency"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('priceAlert.freqLabel')}
                    </FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        className="grid grid-cols-1 gap-2"
                      >
                        {FREQUENCY_OPTIONS.map((opt) => (
                          <label
                            key={opt.value}
                            htmlFor={`freq-${opt.value}`}
                            className={`flex items-start gap-3 rounded-lg border p-2.5 cursor-pointer transition-all ${frequency === opt.value
                                ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500/30'
                                : 'border-slate-200 hover:border-blue-300'
                              }`}
                          >
                            <RadioGroupItem
                              id={`freq-${opt.value}`}
                              value={opt.value}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-blue-600 ${frequency === opt.value ? '' : 'text-slate-400'}`}>
                                  {opt.icon}
                                </span>
                                <span className="text-sm font-medium">{t(opt.labelKey)}</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {t(opt.descKey)}
                              </div>
                            </div>
                          </label>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
  )
}
