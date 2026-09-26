'use client'

/**
 * The days-of-week field of ScheduleFormDialog — per-day toggles plus
 * the Tất cả / Ngày thường / Cuối tuần / Bỏ chọn presets.
 *
 * Extracted from the original 'src/features/admin/schedules/schedule-form.tsx'.
 */

import { Button } from '@/components/ui/button'
import {
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { useT } from '@/lib/i18n'
import type { ScheduleFormInstance } from './schedule-schema'

// Day-of-week chip labels — i18n keys, translated at render time
// (mirrors DAY_FULL from '@/features/admin/types').
const DAY_KEYS = [
  'adminSchedules.dayFull.mon',
  'adminSchedules.dayFull.tue',
  'adminSchedules.dayFull.wed',
  'adminSchedules.dayFull.thu',
  'adminSchedules.dayFull.fri',
  'adminSchedules.dayFull.sat',
  'adminSchedules.dayFull.sun',
]

export function ScheduleDaysField({
  form,
  toggleDay,
  setDays,
}: {
  form: ScheduleFormInstance
  toggleDay: (i: number) => void
  setDays: (next: boolean[]) => void
}) {
  const t = useT()
  return (
              <FormField
                control={form.control}
                name="days"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>{t('adminSchedules.daysOfWeekLabel')}</FormLabel>
                    <div className="flex gap-1 flex-wrap">
                      {DAY_KEYS.map((key, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleDay(i)}
                          className={`px-2.5 py-1.5 rounded-md text-xs border transition-colors ${field.value[i]
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-muted-foreground hover:bg-slate-50'
                            }`}
                        >
                          {t(key)}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5 mt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setDays([true, true, true, true, true, true, true])}
                      >
                        {t('common.all')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setDays([true, true, true, true, true, false, false])}
                      >
                        {t('adminSchedules.weekdays')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setDays([false, false, false, false, false, true, true])}
                      >
                        {t('adminSchedules.weekend')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setDays([false, false, false, false, false, false, false])}
                      >
                        {t('adminSchedules.clearDays')}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
  )
}
