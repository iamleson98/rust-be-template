'use client'

/**
 * RouteFormDialog — create/edit a Route under a given Brand.
 *
 * The start/end location fields use a fixed list of Vietnamese cities
 * (5 municipalities + 58 provinces = 63 total). Brands define pickup/drop
 * at the city level; specific pickup points (bus stations, curbside stops)
 * are defined at the schedule level.
 *
 * The city id is a slug (e.g. "ha-noi", "da-nang") stored as the
 * `startLocationId` / `endLocationId` on the route. It's NOT a UUID —
 * the backend stores it as a TEXT reference.
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { Route as RouteIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { requiredText, positiveInt } from '@/lib/forms'
import { useUpsertAdminRoute } from '@/lib/queries'
import {
  VIETNAMESE_CITIES,
  type VietnameseCity,
} from '@/lib/vietnamese-cities'
import type { AdminRouteOut } from '@/lib/api/types.gen'
import type { AdminBrandOut } from '@/lib/api/types.gen'

const routeSchema = z
  .object({
    name: requiredText('Tên tuyến')
      .min(2, 'Tên tuyến cần ít nhất 2 ký tự')
      .max(255, 'Tên tuyến tối đa 255 ký tự'),
    startLocationId: requiredText('Điểm đi'),
    endLocationId: requiredText('Điểm đến'),
    distanceKm: z.coerce
      .number({ message: 'Khoảng cách phải là số' })
      .min(1, 'Khoảng cách phải lớn hơn 0')
      .max(50000, 'Khoảng cách quá lớn'),
    durationMin: positiveInt(1),
  })
  .refine((d) => d.startLocationId !== d.endLocationId, {
    message: 'Điểm đi và điểm đến phải khác nhau',
    path: ['endLocationId'],
  })
type RouteFormValues = z.infer<typeof routeSchema>

// Group cities by region for the Select dropdown.
const NORTH = VIETNAMESE_CITIES.filter((c) => c.region === 'north')
const CENTRAL = VIETNAMESE_CITIES.filter((c) => c.region === 'central')
const SOUTH = VIETNAMESE_CITIES.filter((c) => c.region === 'south')

function CitySelectContent() {
  return (
    <SelectContent className="max-h-80">
      <SelectGroup>
        <SelectLabel className="text-xs font-semibold uppercase text-blue-600">
          Miền Bắc
        </SelectLabel>
        {NORTH.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectGroup>
      <SelectGroup>
        <SelectLabel className="text-xs font-semibold uppercase text-amber-600">
          Miền Trung
        </SelectLabel>
        {CENTRAL.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectGroup>
      <SelectGroup>
        <SelectLabel className="text-xs font-semibold uppercase text-emerald-600">
          Miền Nam
        </SelectLabel>
        {SOUTH.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  )
}

export function RouteFormDialog({
  open,
  route,
  brand,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  route: AdminRouteOut | null
  brand: AdminBrandOut | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const isEdit = !!route
  const upsertMutation = useUpsertAdminRoute()
  const saving = upsertMutation.isPending

  const form = useForm<z.input<typeof routeSchema>, unknown, z.output<typeof routeSchema>>({
    resolver: zodResolver(routeSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      name: '',
      startLocationId: '',
      endLocationId: '',
      distanceKm: 0,
      durationMin: 0,
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: route?.name ?? '',
        startLocationId: route?.startLocationId ?? '',
        endLocationId: route?.endLocationId ?? '',
        distanceKm: route?.distanceKm ?? 0,
        durationMin: route?.durationMin ?? 0,
      })
    }
  }, [open, route, form])

  const onSubmit = async (values: RouteFormValues) => {
    if (!brand) {
      toast.error('Chưa chọn hãng xe')
      return
    }
    try {
      const payload: Record<string, unknown> = {
        brandId: brand.id,
        name: values.name.trim(),
        startLocationId: values.startLocationId,
        endLocationId: values.endLocationId,
        distanceKm: values.distanceKm,
        durationMin: values.durationMin,
      }
      if (isEdit) {
        payload.id = route!.id
      }
      await upsertMutation.mutateAsync(payload as any)
      toast.success(isEdit ? 'Đã cập nhật tuyến' : 'Đã thêm tuyến mới')
      onSaved()
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể lưu tuyến')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-blue-600" />
            {isEdit ? 'Sửa tuyến đường' : 'Thêm tuyến đường mới'}
          </DialogTitle>
          <DialogDescription>
            {brand ? (
              <>
                Thuộc hãng:{' '}
                <span className="font-medium" style={{ color: brand.accentColor as any }}>
                  {brand.name}
                </span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3 max-w-xl">
            {/* Route name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    Tên tuyến <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Hà Nội → Đà Nẵng" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Start location — city dropdown */}
            <FormField
              control={form.control}
              name="startLocationId"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    Điểm đi (thành phố) <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Chọn thành phố đi..." />
                      </SelectTrigger>
                    </FormControl>
                    <CitySelectContent />
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* End location — city dropdown */}
            <FormField
              control={form.control}
              name="endLocationId"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    Điểm đến (thành phố) <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Chọn thành phố đến..." />
                      </SelectTrigger>
                    </FormControl>
                    <CitySelectContent />
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Distance + Duration */}
            <div className="grid grid-cols-2 gap-3 items-start">
              <FormField
                control={form.control}
                name="distanceKm"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>
                      Khoảng cách (km) <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={field.value === 0 || field.value == null ? '' : String(field.value)}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        placeholder="650"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="durationMin"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>
                      Thời lượng (phút) <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={field.value === 0 || field.value == null ? '' : String(field.value)}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        placeholder="720"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                  <>{isEdit ? 'Lưu thay đổi' : 'Thêm tuyến'}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
