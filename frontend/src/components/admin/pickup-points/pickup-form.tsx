'use client'

/**
 * PickupPointFormDialog — create/edit a PickupPoint under a given Route.
 *
 * Migrated from manual `fetch` POST/PUT to the `useUpsertAdminPickupPoint()`
 * TanStack Query mutation. The mutation auto-invalidates the pickup-points
 * list query on success.
 */

import { useEffect, useMemo } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
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
import { MapPin, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { requiredText, positiveInt, optionalText } from '@/lib/forms'
import { useUpsertAdminPickupPoint } from '@/lib/queries'
import type { AdminPickupPointOut, PlaceOut, AdminRouteOut } from '@/lib/api/types.gen'

const pickupPointSchema = z.object({
  placeId: requiredText('Địa điểm'),
  name: requiredText('Tên hiển thị')
    .min(2, 'Tên cần ít nhất 2 ký tự')
    .max(120, 'Tên quá dài'),
  stopOrder: positiveInt(0),
  etaOffsetMin: z.coerce
    .number({ message: 'ETA phải là số' })
    .int('ETA phải là số nguyên')
    .min(0, 'ETA phải ≥ 0'),
  pickupType: z.enum(['station', 'curb', 'on_request']),
  address: optionalText(1000),
})
type PickupPointFormValues = z.infer<typeof pickupPointSchema>

export function PickupPointFormDialog({
  open,
  pickup,
  route,
  places,
  existingCount,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  pickup: AdminPickupPointOut | null
  route: AdminRouteOut | null
  places: PlaceOut[]
  existingCount: number
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const isEdit = !!pickup
  const upsertMutation = useUpsertAdminPickupPoint()
  const saving = upsertMutation.isPending

  const form = useForm<z.input<typeof pickupPointSchema>, unknown, z.output<typeof pickupPointSchema>>({
    resolver: zodResolver(pickupPointSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      placeId: '',
      name: '',
      stopOrder: existingCount + 1,
      etaOffsetMin: 0,
      pickupType: 'station',
      address: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        placeId: '',
        name: pickup?.name ?? '',
        stopOrder: pickup ? pickup.stopOrder : existingCount + 1,
        etaOffsetMin: 0,
        pickupType:
          pickup?.kind === 'curb' || pickup?.kind === 'on_request'
            ? pickup.kind
            : 'station',
        address: pickup?.address ?? '',
      })
    }
  }, [open, pickup, existingCount, form])

  const sortedPlaces = useMemo(() => {
    return [...places].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [places])

  const nameValue = form.watch('name')

  const onSelectPlace = (placeId: string) => {
    form.setValue('placeId', placeId, { shouldValidate: true, shouldDirty: true })
    // auto-fill name with place name if name is empty
    const place = places.find((p) => p.id === placeId)
    if (place && !nameValue.trim()) {
      form.setValue('name', place.name, { shouldValidate: true, shouldDirty: true })
    }
  }

  const onSubmit = async (values: PickupPointFormValues) => {
    if (!route) {
      toast.error('Chưa chọn tuyến đường')
      return
    }
    try {
      // Derive lat/lon from the selected place — the backend's
      // `UpsertPickupPointRequest` has `lat: Option<f64>` + `lon: Option<f64>`
      // but NOT a `placeId` field. The previous version sent `placeId` +
      // `pickupType` + `etaOffsetMin` (none exist in the backend) and
      // omitted `lat`/`lon` → the row was saved with null coordinates.
      const selectedPlace = places.find((p) => p.id === values.placeId)
      const payload: Record<string, unknown> = {
        routeId: route.id,
        name: values.name.trim(),
        address: (values.address ?? '').trim(),
        lat: selectedPlace?.lat,
        lon: selectedPlace?.lon,
        stopOrder: values.stopOrder,
        // Backend field is `kind` (not `pickupType`).
        kind: values.pickupType,
      }
      if (isEdit) {
        payload.id = pickup!.id
      }
      await upsertMutation.mutateAsync(payload as any)
      toast.success(isEdit ? 'Đã cập nhật điểm đón/trả' : 'Đã thêm điểm đón/trả mới')
      onSaved()
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể lưu điểm đón/trả')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-rose-600" />
            {isEdit ? 'Sửa điểm đón/trả' : 'Thêm điểm đón/trả mới'}
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
            <FormField
              control={form.control}
              name="placeId"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    Địa điểm <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select value={field.value} onValueChange={onSelectPlace}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn địa điểm..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-70">
                      {sortedPlaces.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 text-rose-500" />
                            <span>{p.name}</span>
                            {p.province && (
                              <span className="text-[10px] text-muted-foreground">· {p.province}</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    Tên hiển thị <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Bến xe Miền Đông · Cổng A" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="stopOrder"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>Thứ tự</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        value={field.value === 0 || field.value == null ? '' : String(field.value)}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="etaOffsetMin"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>ETA (phút)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        value={field.value === 0 || field.value == null ? '' : String(field.value)}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        placeholder="0"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pickupType"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>Loại đón</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="station">Bến xe</SelectItem>
                        <SelectItem value="curb">Đón ven đường</SelectItem>
                        <SelectItem value="on_request">Theo yêu cầu</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>Địa chỉ chi tiết</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      placeholder="Số nhà, đường, quận/huyện..."
                      rows={2}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Huỷ
              </Button>
              <Button type="submit" disabled={saving} className="bg-rose-600 hover:bg-rose-700">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang lưu...
                  </>
                ) : (
                  <>{isEdit ? 'Lưu thay đổi' : 'Thêm điểm'}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
