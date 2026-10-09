'use client'

import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
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

/** The amenity toggle chips of ScheduleFormDialog. */
export function ScheduleAmenitiesField({
  form,
  toggleAmenity,
}: {
  form: ScheduleFormInstance
  toggleAmenity: (key: string) => void
}) {
  const t = useT()
  return (
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
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
                    active
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
  )
}
