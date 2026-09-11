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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { fetchVehicleTypesPage } from '@/lib/queries'
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
  return (
    <>
              <div className="grid grid-cols-2 gap-3 items-start">
                <FormField
                  control={form.control}
                  name="departureTime"
                  render={({ field }) => (
                    <FormItem className="grid gap-1.5">
                      <FormLabel>
                        Giờ khởi hành <span className="text-destructive">*</span>
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
                        Loại xe <span className="text-destructive">*</span>
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
                          placeholder="Chọn loại xe…"
                          searchPlaceholder="Tìm loại xe…"
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
                        Hiệu lực từ <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <DatePicker
                          value={field.value}
                          onChange={(v) => field.onChange(v ?? '')}
                          placeholder="Chọn ngày bắt đầu…"
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
                        Hiệu lực đến <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <DatePicker
                          value={field.value}
                          onChange={(v) => field.onChange(v ?? '')}
                          placeholder="Chọn ngày kết thúc…"
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
                    <FormLabel>Sơ đồ ghế (tùy chọn)</FormLabel>
                    <Select
                      value={field.value || NO_LAYOUT}
                      onValueChange={(v) => field.onChange(v === NO_LAYOUT ? '' : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn sơ đồ ghế (nếu có)…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_LAYOUT}>
                          <span className="text-muted-foreground">— Không chọn —</span>
                        </SelectItem>
                        {busLayouts.length === 0 ? (
                          <div className="p-2 text-xs text-muted-foreground text-center">
                            Hãng chưa có sơ đồ ghế nào
                          </div>
                        ) : (
                          busLayouts.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              <span className="flex items-center gap-1.5">
                                <span>{l.name}</span>
                                {l.totalSeats ? (
                                  <span className="text-[10px] text-muted-foreground">
                                    · {l.totalSeats} chỗ
                                  </span>
                                ) : null}
                              </span>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
    </>
  )
}
