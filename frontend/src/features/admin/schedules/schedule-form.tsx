'use client'

/**
 * ScheduleFormDialog — create/edit a Schedule under a given Route.
 *
 * Besides the classic fields (departure time, effective window, days of
 * week, prices, amenities), the form manages:
 *
 *   - **Vehicle type** ("Loại xe") — required, picked from the
 *     admin-managed `vehicle_type` catalog through the searchable,
 *     infinite-scroll `InfiniteSelect` (`fetchVehicleTypesPage`).
 *   - **Seat layout** ("Sơ đồ ghế") — optional refinement, the brand's
 *     bus layouts.
 *   - **Ordered address sequence** with an optional arrival time per
 *     point (`arrivalTime`, HH:MM) so the operator can publish when the
 *     vehicle reaches each pickup/drop stop:
 *       - điểm khởi hành (first pickup) — required
 *       - điểm trung gian (midway stops) — ordered, add/remove/reorder
 *       - điểm kết thúc (final drop) — required
 *     Each point is an AddressPointSelect — an infinite-scroll,
 *     server-side-searched picker scoped to the route's brand. When the
 *     wanted address does not exist yet, the "＋" button opens
 *     AddressMapDialog (map + full-text search) and the freshly created
 *     address is immediately selected.
 *
 * Time fields use the shared `TimePicker` (shadcn docs pattern: native
 * `<input type="time">`, HH:MM value); dates use `DatePicker`
 * (Popover + Calendar, Vietnamese locale).
 *
 * Migrated from manual `fetch` POST/PUT to the `useUpsertAdminSchedule()`
 * TanStack Query mutation. The mutation auto-invalidates the schedules list
 * query on success.
 */

import { useEffect, useMemo, useState } from 'react'
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
import { DatePicker } from '@/components/ui/date-picker'
import { InfiniteSelect } from '@/components/ui/infinite-select'
import { TimePicker } from '@/components/ui/time-picker'
import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  Clock,
  Flag,
  Loader2,
  MapPin,
  Plus,
  Route as RouteIcon,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { requiredText } from '@/lib/forms'
import { fetchVehicleTypesPage, useUpsertAdminSchedule } from '@/lib/queries'
import type {
  AdminAddressOut,
  AdminBusLayoutOut,
  AdminRouteOut,
  AdminScheduleOut,
  AdminVehicleTypeOut,
} from '@/lib/api/types.gen'
import { DAY_FULL, AMENITY_OPTIONS } from '@/features/admin/types'
import { AddressMapDialog } from '@/features/admin/addresses/address-map-dialog'
import { AddressPointSelect } from '@/features/admin/addresses/address-point-select'

const HHMM = /^\d{2}:\d{2}$/

/** Sentinel value for "no seat layout" — Base UI treats '' as
 * "no selection", so the explicit empty option needs a real value. */
const NO_LAYOUT = '__none__'

/** Optional `HH:MM` — `null` when unset (what TimePicker emits). */
const optionalTime = z
  .string()
  .regex(HHMM, 'Giờ không hợp lệ (định dạng HH:MM)')
  .nullish()

/** One midway stop: the address plus its optional arrival time. */
const middlePoint = z.object({
  id: z.string(),
  time: optionalTime,
})

const scheduleSchema = z
  .object({
    departureTime: requiredText('Giờ khởi hành').regex(HHMM, 'Giờ không hợp lệ (định dạng HH:MM)'),
    effectiveFrom: requiredText('Ngày bắt đầu'),
    effectiveTo: requiredText('Ngày kết thúc'),
    days: z.array(z.boolean()).length(7),
    /** Vehicle class from the admin-managed catalog — required. */
    vehicleTypeId: requiredText('Loại xe'),
    /** Optional brand seat layout refinement. */
    busLayoutId: z.string(),
    basePriceAdult: z.coerce
      .number({ message: 'Giá phải là số' })
      .min(0, 'Giá phải ≥ 0')
      .max(1_000_000_000, 'Giá quá lớn'),
    basePriceChild: z.coerce
      .number({ message: 'Giá phải là số' })
      .min(0, 'Giá phải ≥ 0')
      .max(1_000_000_000, 'Giá quá lớn'),
    // Amenities are stored as a comma-separated string in the backend
    // (`amenities: Option<String>` max 5000 chars). The form edits them
    // as an array of strings for UX (checkboxes), but we MUST join them
    // into a single string before sending. The previous version sent
    // the array directly → serde would 422 because it expects a string.
    amenities: z.array(z.string()).max(20, 'Tối đa 20 tiện ích'),
    // ── Address point sequence (display = name, value = address id) ──
    startPointId: requiredText('Điểm khởi hành'),
    startPointTime: optionalTime,
    endPointId: requiredText('Điểm kết thúc'),
    endPointTime: optionalTime,
    middlePoints: z.array(middlePoint),
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
  brandId,
  brandName,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  schedule: AdminScheduleOut | null
  route: AdminRouteOut | null
  busLayouts: AdminBusLayoutOut[]
  brandId?: string
  brandName?: string
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const isEdit = !!schedule
  const upsertMutation = useUpsertAdminSchedule()
  const saving = upsertMutation.isPending

  // Addresses created inside this dialog session — merged as extras so
  // the new option appears instantly (the query invalidation refreshes
  // the canonical list in the background).
  const [extraAddresses, setExtraAddresses] = useState<AdminAddressOut[]>([])
  // Which point slot triggered the "create address" modal.
  const [createFor, setCreateFor] = useState<'start' | 'end' | number | null>(null)
  const [addressDialogOpen, setAddressDialogOpen] = useState(false)

  // Addresses the picker must always be able to resolve: the schedule's
  // existing points (edit mode — they embed the full address) plus ones
  // created during this dialog session.
  const knownAddresses = useMemo(() => {
    const base = schedule?.points?.map((p) => p.address as AdminAddressOut) ?? []
    const seen = new Set(base.map((a) => a.id))
    return [...base, ...extraAddresses.filter((a) => !seen.has(a.id))]
  }, [schedule, extraAddresses])

  const form = useForm<z.input<typeof scheduleSchema>, unknown, z.output<typeof scheduleSchema>>({
    resolver: zodResolver(scheduleSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      departureTime: '08:00',
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      days: [true, true, true, true, true, true, true],
      vehicleTypeId: '',
      busLayoutId: '',
      basePriceAdult: 0,
      basePriceChild: 0,
      amenities: [],
      startPointId: '',
      startPointTime: null,
      endPointId: '',
      endPointTime: null,
      middlePoints: [],
    },
  })

  useEffect(() => {
    if (open) {
      const ds = schedule?.daysOfWeek ?? '1111111'
      // Split the ordered points into start / middles / end by kind.
      const points = schedule?.points ?? []
      const startPoint = points.find((p) => p.kind === 'pickup')
      const endPoint = points.find((p) => p.kind === 'drop')
      const middles = points.filter((p) => p.kind === 'middle')
      form.reset({
        departureTime: schedule?.departureTime ?? '08:00',
        effectiveFrom: schedule?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        effectiveTo:
          schedule?.effectiveTo ?? new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        days: [0, 1, 2, 3, 4, 5, 6].map((i) => ds[i] === '1'),
        vehicleTypeId: schedule?.vehicleTypeId ?? '',
        busLayoutId: schedule?.busLayoutId ?? '',
        basePriceAdult: schedule ? schedule.basePriceAdult : 0,
        basePriceChild: schedule ? schedule.basePriceChild : 0,
        amenities: schedule?.amenities ? schedule.amenities.split(',').filter(Boolean) : [],
        startPointId: startPoint?.addressId ?? '',
        startPointTime: startPoint?.arrivalTime ?? null,
        endPointId: endPoint?.addressId ?? '',
        endPointTime: endPoint?.arrivalTime ?? null,
        middlePoints: middles.map((p) => ({ id: p.addressId, time: p.arrivalTime ?? null })),
      })
      setExtraAddresses([])
      setCreateFor(null)
    }
  }, [open, schedule, form])

  const days = form.watch('days')
  const effectiveFrom = form.watch('effectiveFrom')
  const amenitiesValue = form.watch('amenities')
  const startPointId = form.watch('startPointId')
  const endPointId = form.watch('endPointId')
  const middlePoints = form.watch('middlePoints')

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

  // ── Middle point list operations ─────────────────────────────────
  const addMiddle = () => {
    form.setValue('middlePoints', [...middlePoints, { id: '', time: null }], { shouldDirty: true })
  }
  const removeMiddle = (index: number) => {
    form.setValue(
      'middlePoints',
      middlePoints.filter((_, i) => i !== index),
      { shouldDirty: true },
    )
  }
  const setMiddle = (index: number, value: string | undefined) => {
    form.setValue(
      'middlePoints',
      middlePoints.map((m, i) => (i === index ? { ...m, id: value ?? '' } : m)),
      { shouldValidate: true, shouldDirty: true },
    )
  }
  const setMiddleTime = (index: number, time: string | null) => {
    form.setValue(
      'middlePoints',
      middlePoints.map((m, i) => (i === index ? { ...m, time } : m)),
      { shouldDirty: true },
    )
  }
  const moveMiddle = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= middlePoints.length) return
    const next = [...middlePoints]
      ;[next[index], next[target]] = [next[target], next[index]]
    form.setValue('middlePoints', next, { shouldDirty: true })
  }

  // ── "Create address for this point" flow ──────────────────────────
  const openCreateFor = (slot: 'start' | 'end' | number) => {
    setCreateFor(slot)
    setAddressDialogOpen(true)
  }

  const handleAddressCreated = (addr: AdminAddressOut) => {
    setExtraAddresses((prev) => [...prev, addr])
    // Immediately adopt the new address for the slot that asked for it.
    if (createFor === 'start') {
      form.setValue('startPointId', addr.id, { shouldValidate: true, shouldDirty: true })
    } else if (createFor === 'end') {
      form.setValue('endPointId', addr.id, { shouldValidate: true, shouldDirty: true })
    } else if (typeof createFor === 'number') {
      setMiddle(createFor, addr.id)
    }
    setCreateFor(null)
  }

  const onSubmit = async (values: ScheduleFormValues) => {
    if (!route) {
      toast.error('Chưa chọn tuyến đường')
      return
    }
    try {
      const daysStr = values.days.map((v) => (v ? '1' : '0')).join('')
      // Ordered point sequence: start → middles → end. The backend
      // derives kind (pickup/middle/drop) from array position; each
      // point carries its optional arrivalTime.
      const points = [
        { addressId: values.startPointId, arrivalTime: values.startPointTime ?? null },
        ...values.middlePoints
          .filter((m) => !!m.id)
          .map((m) => ({ addressId: m.id, arrivalTime: m.time ?? null })),
        { addressId: values.endPointId, arrivalTime: values.endPointTime ?? null },
      ]
      const payload: Record<string, unknown> = {
        routeId: route.id,
        departureTime: values.departureTime,
        effectiveFrom: values.effectiveFrom,
        effectiveTo: values.effectiveTo,
        daysOfWeek: daysStr,
        vehicleTypeId: values.vehicleTypeId,
        // Optional seat layout — empty string means "none".
        busLayoutId: values.busLayoutId || null,
        basePriceAdult: values.basePriceAdult,
        basePriceChild: values.basePriceChild,
        // Backend stores `amenities` as `Option<String>` (comma-separated).
        // The form edits them as an array — join before sending. The
        // previous version sent the array directly → serde 422.
        amenities: values.amenities.join(','),
        points,
      }
      if (isEdit) {
        payload.id = schedule!.id
      }
      // SDK mutation hooks require { body: <payload> } — passing the raw
      // payload makes `opts.body === undefined`, which causes the openapi-ts
      // client to delete `Content-Type: application/json` before sending,
      // and axum's `Json<T>` extractor then returns 415 Unsupported Media Type.
      await upsertMutation.mutateAsync({ body: payload } as any)
      toast.success(isEdit ? 'Đã cập nhật lịch trình' : 'Đã thêm lịch trình mới')
      onSaved()
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể lưu lịch trình')
    }
  }

  const startName = knownAddresses.find((a) => a.id === startPointId)?.name
  const endName = knownAddresses.find((a) => a.id === endPointId)?.name

  // The schedule's configured vehicle type (edit mode) resolves the
  // select's trigger label even before the first page lands.
  const scheduleVehicleType = schedule?.vehicleType ?? undefined

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600" />
              {isEdit ? 'Sửa lịch trình' : 'Thêm lịch trình mới'}
            </DialogTitle>
            <DialogDescription>
              {route ? (
                <>
                  Tuyến: <span className="font-medium">{route.name}</span>
                  {brandName ? (
                    <span className="text-muted-foreground"> · {brandName}</span>
                  ) : null}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              {/* ── Điểm đón / trả (address sequence + arrival times) ── */}
              <div className="rounded-lg border bg-slate-50/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <RouteIcon className="h-4 w-4 text-blue-600" />
                    Lộ trình đón — trả khách
                  </div>
                  {startName && endName ? (
                    <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                      <CircleDot className="h-3 w-3 text-blue-600 shrink-0" />
                      <span className="truncate">{startName}</span>
                      <span className="shrink-0">→</span>
                      <span className="text-muted-foreground/70 shrink-0">
                        +{middlePoints.filter((m) => !!m.id).length}
                      </span>
                      <span className="shrink-0">→</span>
                      <Flag className="h-3 w-3 text-rose-600 shrink-0" />
                      <span className="truncate">{endName}</span>
                    </span>
                  ) : null}
                </div>

                {/* Start point + arrival time */}
                <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                  <FormField
                    control={form.control}
                    name="startPointId"
                    render={({ field }) => (
                      <FormItem className="grid gap-1.5">
                        <FormLabel>
                          <span className="flex items-center gap-1.5">
                            <CircleDot className="h-3.5 w-3.5 text-blue-600" />
                            Điểm khởi hành <span className="text-destructive">*</span>
                          </span>
                        </FormLabel>
                        <FormControl>
                          <AddressPointSelect
                            kind="pickup"
                            value={field.value}
                            onChange={field.onChange}
                            brandId={brandId}
                            extraAddresses={knownAddresses}
                            onCreateNew={() => openCreateFor('start')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="startPointTime"
                    render={({ field }) => (
                      <FormItem className="grid gap-1.5 w-30">
                        <FormLabel className="text-muted-foreground">Giờ đến</FormLabel>
                        <FormControl>
                          <TimePicker value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Middle points (ordered) + arrival times */}
                <FormField
                  control={form.control}
                  name="middlePoints"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <FormLabel className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-amber-600" />
                        Điểm trung gian (đón / trả giữa đường)
                      </FormLabel>
                      <div className="space-y-2">
                        {field.value.map((mid, i: number) => (
                          <div key={i} className="grid grid-cols-[auto_1fr_auto_auto] gap-1.5 items-center">
                            <span className="h-6 w-6 shrink-0 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold flex items-center justify-center border border-amber-200">
                              {i + 1}
                            </span>
                            <AddressPointSelect
                              kind="middle"
                              value={mid.id || undefined}
                              onChange={(v) => setMiddle(i, v)}
                              brandId={brandId}
                              extraAddresses={knownAddresses}
                              onCreateNew={() => openCreateFor(i)}
                            />
                            <div className="w-28">
                              <TimePicker
                                value={mid.time ?? null}
                                onChange={(t) => setMiddleTime(i, t)}
                                placeholder="--:--"
                              />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                aria-label="Di chuyển lên"
                                disabled={i === 0}
                                onClick={() => moveMiddle(i, -1)}
                                className="h-4 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                aria-label="Di chuyển xuống"
                                disabled={i === field.value.length - 1}
                                onClick={() => moveMiddle(i, 1)}
                                className="h-4 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>
                            <button
                              type="button"
                              aria-label="Xoá điểm trung gian"
                              onClick={() => removeMiddle(i)}
                              className="col-start-4 justify-self-center h-9 w-9 shrink-0 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={addMiddle}
                          className="w-full h-9 rounded-md border border-dashed text-sm text-muted-foreground hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50/50 flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Thêm điểm trung gian
                        </button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* End point + arrival time */}
                <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                  <FormField
                    control={form.control}
                    name="endPointId"
                    render={({ field }) => (
                      <FormItem className="grid gap-1.5">
                        <FormLabel>
                          <span className="flex items-center gap-1.5">
                            <Flag className="h-3.5 w-3.5 text-rose-600" />
                            Điểm kết thúc <span className="text-destructive">*</span>
                          </span>
                        </FormLabel>
                        <FormControl>
                          <AddressPointSelect
                            kind="drop"
                            value={field.value}
                            onChange={field.onChange}
                            brandId={brandId}
                            extraAddresses={knownAddresses}
                            onCreateNew={() => openCreateFor('end')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endPointTime"
                    render={({ field }) => (
                      <FormItem className="grid gap-1.5 w-30">
                        <FormLabel className="text-muted-foreground">Giờ đến</FormLabel>
                        <FormControl>
                          <TimePicker value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Cột “Giờ đến” là thời gian xe dự kiến tới mỗi điểm (không bắt buộc).
                </p>
              </div>

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

              <div className="grid grid-cols-2 gap-3 items-start">
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
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors ${active
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

      {/* Create a brand-new address from the map (for any point slot). */}
      <AddressMapDialog
        open={addressDialogOpen}
        onOpenChange={setAddressDialogOpen}
        brandId={brandId}
        brandName={brandName}
        onCreated={handleAddressCreated}
      />
    </>
  )
}
