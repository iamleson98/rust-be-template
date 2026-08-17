'use client'

/**
 * ScheduleFormDialog — create/edit a Schedule under a given Route.
 *
 * Migrated from manual `fetch` POST/PUT to the `useUpsertAdminSchedule()`
 * TanStack Query mutation. The mutation auto-invalidates the schedules list
 * query on success.
 */

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Clock, Bus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { requiredText } from '@/lib/forms'
import { useUpsertAdminSchedule } from '@/lib/queries'
import type { BusLayout, RouteItem, Schedule } from '@/components/admin/types'
import { DAY_FULL, AMENITY_OPTIONS } from '@/components/admin/types'
import { VEHICLE_TYPE_LABELS as VEHICLE_LABELS } from '@/lib/types'

const scheduleSchema = z
  .object({
    departureTime: requiredText('Giờ khởi hành')
      .regex(/^\d{2}:\d{2}$/, 'Giờ không hợp lệ (định dạng HH:MM)'),
    effectiveFrom: requiredText('Ngày bắt đầu'),
    effectiveTo: requiredText('Ngày kết thúc'),
    days: z.array(z.boolean()).length(7),
    busLayoutId: requiredText('Loại xe'),
    basePriceAdult: z.coerce
      .number({ message: 'Giá phải là số' })
      .min(0, 'Giá phải ≥ 0'),
    basePriceChild: z.coerce
      .number({ message: 'Giá phải là số' })
      .min(0, 'Giá phải ≥ 0'),
    amenities: z.array(z.string()),
  })
  .refine(
    (d) => !d.effectiveFrom || !d.effectiveTo || d.effectiveFrom <= d.effectiveTo,
    {
      message: 'Ngày kết thúc phải sau ngày bắt đầu',
      path: ['effectiveTo'],
    },
  )
type ScheduleFormValues = z.infer<typeof scheduleSchema>

export function ScheduleFormDialog({
  open,
  schedule,
  route,
  busLayouts,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  schedule: Schedule | null
  route: RouteItem | null
  busLayouts: BusLayout[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const isEdit = !!schedule
  const upsertMutation = useUpsertAdminSchedule()
  const saving = upsertMutation.isPending

  const form = useForm<z.input<typeof scheduleSchema>, unknown, z.output<typeof scheduleSchema>>({
    resolver: zodResolver(scheduleSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      departureTime: '08:00',
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      days: [true, true, true, true, true, true, true],
      busLayoutId: '',
      basePriceAdult: 0,
      basePriceChild: 0,
      amenities: [],
    },
  })

  useEffect(() => {
    if (open) {
      const ds = schedule?.daysOfWeek ?? '1111111'
      form.reset({
        departureTime: schedule?.departureTime ?? '08:00',
        effectiveFrom: schedule?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        effectiveTo:
          schedule?.effectiveTo ?? new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        days: [0, 1, 2, 3, 4, 5, 6].map((i) => ds[i] === '1'),
        busLayoutId: schedule?.busLayoutId ?? busLayouts[0]?.id ?? '',
        basePriceAdult: schedule ? schedule.basePriceAdult : 0,
        basePriceChild: schedule ? schedule.basePriceChild : 0,
        amenities: schedule?.amenities ? schedule.amenities.split(',').filter(Boolean) : [],
      })
    }
  }, [open, schedule, busLayouts, form])

  const days = form.watch('days')
  const amenitiesValue = form.watch('amenities')

  const toggleDay = (i: number) => {
    form.setValue(
      'days',
      days.map((v, idx) => (idx === i ? !v : v)),
      { shouldValidate: true, shouldDirty: true },
    )
  }

  const setDays = (next: boolean[]) => {
    form.setValue('days', next, { shouldValidate: true, shouldDirty: true })
  }

  const toggleAmenity = (key: string) => {
    const next = amenitiesValue.includes(key)
      ? amenitiesValue.filter((a) => a !== key)
      : [...amenitiesValue, key]
    form.setValue('amenities', next, { shouldDirty: true })
  }

  const onSubmit = async (values: ScheduleFormValues) => {
    if (!route) {
      toast.error('Chưa chọn tuyến đường')
      return
    }
    try {
      const daysStr = values.days.map((v) => (v ? '1' : '0')).join('')
      const payload: Record<string, unknown> = {
        routeId: route.id,
        departureTime: values.departureTime,
        effectiveFrom: values.effectiveFrom,
        effectiveTo: values.effectiveTo,
        daysOfWeek: daysStr,
        busLayoutId: values.busLayoutId,
        basePriceAdult: values.basePriceAdult,
        basePriceChild: values.basePriceChild,
        amenities: values.amenities,
      }
      if (isEdit) {
        payload.id = schedule!.id
      }
      await upsertMutation.mutateAsync(payload as any)
      toast.success(isEdit ? 'Đã cập nhật lịch trình' : 'Đã thêm lịch trình mới')
      onSaved()
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể lưu lịch trình')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            {isEdit ? 'Sửa lịch trình' : 'Thêm lịch trình mới'}
          </DialogTitle>
          <DialogDescription>
            {route ? (
              <>
                Tuyến: <span className="font-medium">{route.name}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-3 max-h-[60vh] overflow-y-auto pr-1"
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="departureTime"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>
                      Giờ khởi hành <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="busLayoutId"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>
                      Loại xe <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn loại xe..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {busLayouts.length === 0 ? (
                          <div className="p-2 text-xs text-muted-foreground text-center">
                            Hãng chưa có loại xe nào
                          </div>
                        ) : (
                          busLayouts.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              <span className="flex items-center gap-1.5">
                                <Bus className="h-3 w-3" />
                                <span>{l.name}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  ({VEHICLE_LABELS[l.vehicleType] ?? l.vehicleType} · {l.capacity} chỗ)
                                </span>
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="effectiveFrom"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>
                      Hiệu lực từ <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
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
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                        className={`px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
                          field.value[i]
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

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="basePriceAdult"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>Giá người lớn (VND)</FormLabel>
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
                    <FormLabel>Giá trẻ em (VND)</FormLabel>
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
                  <FormLabel>Tiện ích trên xe</FormLabel>
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
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Huỷ
              </Button>
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang lưu...
                  </>
                ) : (
                  <>{isEdit ? 'Lưu thay đổi' : 'Thêm lịch trình'}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
