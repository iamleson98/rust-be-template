'use client'

/**
 * The pricing section of ScheduleFormDialog — adult/child base prices
 * and the amenity toggle chips.
 *
 * Extracted from the original 'src/features/admin/schedules/schedule-form.tsx'.
 */

import { Input } from '@/components/ui/input'
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { AMENITY_OPTIONS } from '@/features/admin/types'
import { useT } from '@/lib/i18n'
import type { ScheduleFormInstance } from './schedule-schema'

// Amenity chip labels — i18n keys, translated at render time
// (maps AMENITY_OPTIONS keys from '@/features/admin/types').
const AMENITY_KEYS: Record<string, string> = {
  wifi: 'adminSchedules.amenity.wifi',
  ac: 'adminSchedules.amenity.ac',
  water: 'adminSchedules.amenity.water',
  charging: 'adminSchedules.amenity.charging',
}

export function SchedulePricingFields({
  form,
  toggleAmenity,
}: {
  form: ScheduleFormInstance
  toggleAmenity: (key: string) => void
}) {
  const t = useT()
  return (
    <>
              <div className="grid grid-cols-2 gap-3 items-start">
                <FormField
                  control={form.control}
                  name="basePriceAdult"
                  render={({ field }) => (
                    <FormItem className="grid gap-1.5">
                      <FormLabel>{t('adminSchedules.priceAdult')}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="1000"
                          value={field.value === 0 || field.value == null ? '' : String(field.value)}
                          onChange={(e) => field.onChange(e.target.value)}
                          onBlur={field.onBlur}
                          placeholder="350000"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="basePriceChild"
                  render={({ field }) => (
                    <FormItem className="grid gap-1.5">
                      <FormLabel>{t('adminSchedules.priceChild')}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="1000"
                          value={field.value === 0 || field.value == null ? '' : String(field.value)}
                          onChange={(e) => field.onChange(e.target.value)}
                          onBlur={field.onBlur}
                          placeholder="200000"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="amenities"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>{t('adminSchedules.amenitiesLabel')}</FormLabel>
                    <div className="flex gap-2 flex-wrap">
                      {AMENITY_OPTIONS.map((opt) => {
                        const Icon = opt.icon
                        const active = field.value?.includes(opt.key) ?? false
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => toggleAmenity(opt.key)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors ${active
                              ? 'bg-blue-50 text-blue-700 border-blue-300'
                              : 'bg-white text-muted-foreground hover:bg-slate-50'
                              }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {t(AMENITY_KEYS[opt.key] ?? opt.label)}
                          </button>
                        )
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
    </>
  )
}
