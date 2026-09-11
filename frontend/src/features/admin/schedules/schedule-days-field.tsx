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
import { DAY_FULL } from '@/features/admin/types'
import type { ScheduleFormInstance } from './schedule-schema'

export function ScheduleDaysField({
  form,
  toggleDay,
  setDays,
}: {
  form: ScheduleFormInstance
  toggleDay: (i: number) => void
  setDays: (next: boolean[]) => void
}) {
  return (
              <FormField
                control={form.control}
                name="days"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>Ngày chạy trong tuần</FormLabel>
                    <div className="flex gap-1 flex-wrap">
                      {DAY_FULL.map((label, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleDay(i)}
                          className={`px-2.5 py-1.5 rounded-md text-xs border transition-colors ${field.value[i]
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-muted-foreground hover:bg-slate-50'
                            }`}
                        >
                          {label}
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
                        Tất cả
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setDays([true, true, true, true, true, false, false])}
                      >
                        Ngày thường
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setDays([false, false, false, false, false, true, true])}
                      >
                        Cuối tuần
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px]"
                        onClick={() => setDays([false, false, false, false, false, false, false])}
                      >
                        Bỏ chọn
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
  )
}
