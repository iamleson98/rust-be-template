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
import { Form } from '@/components/ui/form'
import { Clock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useUpsertAdminSchedule } from '@/lib/queries'
import type {
  AdminAddressOut,
  AdminBusLayoutOut,
  AdminRouteOut,
  AdminScheduleOut,
} from '@/lib/api/types.gen'
import { AddressMapDialog } from '@/features/admin/addresses/address-map-dialog'
import { scheduleSchema, type ScheduleFormValues } from './schedule-schema'
import { ScheduleRouteSection } from './schedule-route-section'
import { ScheduleBasicsFields } from './schedule-basics-fields'
import { ScheduleDaysField } from './schedule-days-field'
import { SchedulePricingFields } from './schedule-pricing-fields'

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
              <ScheduleRouteSection
                form={form}
                brandId={brandId}
                knownAddresses={knownAddresses}
                startName={startName}
                endName={endName}
                middlePoints={middlePoints}
                openCreateFor={openCreateFor}
                setMiddle={setMiddle}
                setMiddleTime={setMiddleTime}
                moveMiddle={moveMiddle}
                addMiddle={addMiddle}
                removeMiddle={removeMiddle}
              />

              <ScheduleBasicsFields
                form={form}
                busLayouts={busLayouts}
                effectiveFrom={effectiveFrom}
                scheduleVehicleType={scheduleVehicleType}
              />

              <ScheduleDaysField form={form} toggleDay={toggleDay} setDays={setDays} />

              <SchedulePricingFields form={form} toggleAmenity={toggleAmenity} />

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
