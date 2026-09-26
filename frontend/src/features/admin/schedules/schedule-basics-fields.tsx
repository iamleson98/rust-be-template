'use client'

/**
 * The basic-fields section of ScheduleFormDialog — departure time,
 * vehicle type, effective window and optional seat layout.
 *
 * Extracted from the original 'src/features/admin/schedules/schedule-form.tsx'.
 */

import { DatePicker } from '@/components/ui/date-picker'
import { InfiniteSelect } from '@/components/ui/infinite-select'
import { TimePicker } from '@/components/ui/time-picker'
import { ComboboxField } from '@/components/ui/combobox'
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { fetchVehicleTypesPage } from '@/lib/queries'
import { useT } from '@/lib/i18n'
import type {
  AdminBusLayoutOut,
  AdminVehicleTypeOut,
} from '@/lib/api/types.gen'
import { NO_LAYOUT, type ScheduleFormInstance } from './schedule-schema'

export function ScheduleBasicsFields({
  form,
  busLayouts,
  effectiveFrom,
  scheduleVehicleType,
}: {
  form: ScheduleFormInstance
  busLayouts: AdminBusLayoutOut[]
  effectiveFrom: string
  scheduleVehicleType: AdminVehicleTypeOut | undefined
}) {
  const t = useT()
  return (
    <>
              <div className="grid grid-cols-2 gap-3 items-start">
                <FormField
                  control={form.control}
                  name="departureTime"
                  render={({ field }) => (
                    <FormItem className="grid gap-1.5">
                      <FormLabel>
                        {t('brands.sortDeparture')} <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <TimePicker value={field.value} onChange={(v) => field.onChange(v ?? '')} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vehicleTypeId"
                  render={({ field }) => (
                    <FormItem className="grid gap-1.5">
                      <FormLabel>
                        {t('busLayouts.vehicleType')} <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <InfiniteSelect<AdminVehicleTypeOut>
                          scope="vehicle-types"
                          fetchPage={fetchVehicleTypesPage}
                          value={field.value || null}
                          onValueChange={(v) => field.onChange(v ?? '')}
                          itemValue={(vt) => vt.id}
                          itemLabel={(vt) => vt.label}
                          extraItems={scheduleVehicleType ? [scheduleVehicleType] : []}
                          placeholder={t('adminSchedules.chooseVehicleType')}
                          searchPlaceholder={t('adminSchedules.searchVehicleType')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 items-start">
                <FormField
                  control={form.control}
                  name="effectiveFrom"
                  render={({ field }) => (
                    <FormItem className="grid gap-1.5">
                      <FormLabel>
                        {t('adminSchedules.effectiveFrom')} <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <DatePicker
                          value={field.value}
                          onChange={(v) => field.onChange(v ?? '')}
                          placeholder={t('adminSchedules.chooseStartDate')}
                          clearable={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="effectiveTo"
                  render={({ field }) => (
                    <FormItem className="grid gap-1.5">
                      <FormLabel>
                        {t('adminSchedules.effectiveTo')} <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <DatePicker
                          value={field.value}
                          onChange={(v) => field.onChange(v ?? '')}
                          placeholder={t('adminSchedules.chooseEndDate')}
                          minDate={effectiveFrom || undefined}
                          clearable={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="busLayoutId"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>{t('adminSchedules.seatLayoutOptional')}</FormLabel>
                    <FormControl>
                      <ComboboxField
                        value={field.value || NO_LAYOUT}
                        onValueChange={(v) => field.onChange(v === NO_LAYOUT ? '' : v)}
                        items={[
                          { value: NO_LAYOUT, label: t('adminSchedules.noLayoutOption') },
                          ...busLayouts.map((l) => ({
                            value: l.id,
                            label: l.totalSeats
                              ? `${l.name ?? t('adminSchedules.layoutFallback')} · ${t('busLayouts.seatsCount', { count: l.totalSeats })}`
                              : (l.name ?? t('adminSchedules.layoutFallback')),
                          })),
                        ]}
                        placeholder={t('adminSchedules.chooseSeatLayout')}
                        searchPlaceholder={t('adminSchedules.searchSeatLayout')}
                        emptyText={
                          busLayouts.length === 0
                            ? t('adminSchedules.noLayoutsYet')
                            : t('combobox.noMatch')
                        }
                        aria-label={t('busLayouts.title')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
    </>
  )
}
