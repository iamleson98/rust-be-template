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
 *
 * NOTE: Route distance (km) and duration (min) used to be admin-editable
 * fields, but they have been removed from the entity — the platform now
 * derives ETA from the schedule's `departure_time` + Valhalla routing on
 * the public map page. The form below only collects the route's identity
 * (name, brand, start/end city, status).
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
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { requiredText } from '@/lib/forms'
import { useUpsertAdminRoute, useUpdateAdminRoute } from '@/lib/queries'
import type { AdminRouteOut } from '@/lib/api/types.gen'
import type { AdminBrandOut } from '@/lib/api/types.gen'
import { CitySelectContent, cityLabel } from './city-select-content'
import { getErrorMessage } from '@/lib/error-message'

const routeSchema = z
  .object({
    name: requiredText('Tên tuyến')
      .min(2, 'Tên tuyến cần ít nhất 2 ký tự')
      .max(255, 'Tên tuyến tối đa 255 ký tự'),
    startLocationId: requiredText('Điểm đi'),
    endLocationId: requiredText('Điểm đến'),
  })
  .refine((d) => d.startLocationId !== d.endLocationId, {
    message: 'Điểm đi và điểm đến phải khác nhau',
    path: ['endLocationId'],
  })
type RouteFormValues = z.infer<typeof routeSchema>

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
  const createMutation = useUpsertAdminRoute()
  const updateMutation = useUpdateAdminRoute()
  const saving = createMutation.isPending || updateMutation.isPending

  const form = useForm<z.input<typeof routeSchema>, unknown, z.output<typeof routeSchema>>({
    resolver: zodResolver(routeSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      name: '',
      startLocationId: '',
      endLocationId: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: route?.name ?? '',
        startLocationId: route?.startLocationId ?? '',
        endLocationId: route?.endLocationId ?? '',
      })
    }
  }, [open, route, form])

  const onSubmit = async (values: RouteFormValues) => {
    if (!brand) {
      toast.error('Chưa chọn hãng xe')
      return
    }
    try {
      // SDK mutation hooks require { body: <payload> } — passing the raw
      // payload makes `opts.body === undefined`, which causes the openapi-ts
      // client to delete `Content-Type: application/json` before sending,
      // and axum's `Json<T>` extractor then returns 415 Unsupported Media Type.
      const payload: Record<string, unknown> = {
        brandId: brand.id,
        name: values.name.trim(),
        startLocationId: values.startLocationId,
        endLocationId: values.endLocationId,
      }
      if (isEdit) {
        // PUT /api/admin/routes/{id} — the create endpoint ignores an
        // `id` body field, so posting edits there duplicated routes.
        await updateMutation.mutateAsync({
          path: { id: route!.id },
          body: payload,
        } as unknown as Parameters<typeof updateMutation.mutateAsync>[0])
        toast.success('Đã cập nhật tuyến')
      } else {
        await createMutation.mutateAsync({ body: payload } as unknown as Parameters<typeof createMutation.mutateAsync>[0])
        toast.success('Đã thêm tuyến mới')
      }
      onSaved()
    } catch (e) {
      toast.error(getErrorMessage(e, 'Không thể lưu tuyến'))
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
                <span className="font-medium" style={{ color: brand.accentColor ?? undefined }}>
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
                    value={field.value ?? ''}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Chọn thành phố đi...">
                          {(value: string | null | undefined) => cityLabel(value)}
                        </SelectValue>
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
                    value={field.value ?? ''}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Chọn thành phố đến...">
                          {(value: string | null | undefined) => cityLabel(value)}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <CitySelectContent />
                  </Select>
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
