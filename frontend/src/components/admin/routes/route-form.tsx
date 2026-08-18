'use client'

/**
 * RouteFormDialog — create/edit a Route under a given Brand.
 *
 * Migrated from manual `fetch` POST/PUT to the `useUpsertAdminRoute()`
 * TanStack Query mutation. The mutation auto-invalidates the routes list
 * query (both admin and public) on success.
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
import { Route as RouteIcon, MapPin, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { requiredText, positiveInt } from '@/lib/forms'
import { useUpsertAdminRoute } from '@/lib/queries'
import type { PlaceOut, AdminRouteOut } from '@/lib/api/types.gen'
import type { AdminBrandOut } from '@/lib/api/types.gen'

const routeSchema = z
  .object({
    code: requiredText('Mã tuyến')
      .min(2, 'Mã tuyến cần ít nhất 2 ký tự')
      .max(32, 'Mã tuyến tối đa 32 ký tự'),
    name: requiredText('Tên tuyến')
      .min(2, 'Tên tuyến cần ít nhất 2 ký tự')
      .max(120, 'Tên tuyến tối đa 120 ký tự'),
    startLocationId: requiredText('Điểm đi'),
    endLocationId: requiredText('Điểm đến'),
    distanceKm: z.coerce
      .number({ message: 'Khoảng cách phải là số' })
      .min(1, 'Khoảng cách phải lớn hơn 0'),
    durationMin: positiveInt(1),
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
  places,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  route: AdminRouteOut | null
  brand: AdminBrandOut | null
  places: PlaceOut[]
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
      code: '',
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
        code: route?.id.slice(0, 8) ?? '',
        name: route?.name ?? '',
        startLocationId: route?.startLocationId ?? '',
        endLocationId: route?.endLocationId ?? '',
        distanceKm: route?.distanceKm ?? 0,
        durationMin: route?.durationMin ?? 0,
      })
    }
  }, [open, route, form])

  // Sort places by name for easier selection
  const sortedPlaces = useMemo(() => {
    return [...places].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [places])

  const onSubmit = async (values: RouteFormValues) => {
    if (!brand) {
      toast.error('Chưa chọn hãng xe')
      return
    }
    try {
      const payload: Record<string, unknown> = {
        brandId: brand.id,
        code: values.code.trim(),
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
                Thuộc hãng: <span className="font-medium" style={{ color: brand.accentColor as any }}>{brand.name}</span>
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
                name="code"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>
                      Mã tuyến <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="HN-SGN-01" className="font-mono text-xs" />
                    </FormControl>
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
                      Tên tuyến <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Hà Nội → Sài Gòn" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="startLocationId"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    Điểm đi <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn điểm đi..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-70">
                      {sortedPlaces.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 text-blue-500" />
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
              name="endLocationId"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    Điểm đến <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn điểm đến..." />
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

            <div className="grid grid-cols-2 gap-3">
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
