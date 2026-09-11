'use client'

/**
 * VehicleTypeFormDialog — create/edit a vehicle type (admin catalog).
 *
 * Fields: code (auto-slugified, unique), label, typical seat count,
 * sort order, status (active/disabled) and description. Mirrors the
 * brand-form structure (react-hook-form + zod + generated mutation).
 */

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Bus, Loader2 } from 'lucide-react'
import { requiredText } from '@/lib/forms'
import { useCreateAdminVehicleType, useUpdateAdminVehicleType } from '@/lib/queries'
import { slugify } from '@/lib/slug'
import type { AdminVehicleTypeOut } from '@/lib/api/types.gen'

const vehicleTypeSchema = z.object({
  code: requiredText('Mã loại xe')
    .min(2, 'Mã tối thiểu 2 ký tự')
    .max(60, 'Mã tối đa 60 ký tự')
    .regex(/^[a-z0-9-]+$/, 'Chỉ chữ thường, số và gạch ngang (vd: limousine)'),
  label: requiredText('Tên hiển thị').min(2, 'Tên tối thiểu 2 ký tự').max(120),
  totalSeats: z.coerce
    .number({ message: 'Số ghế phải là số' })
    .min(0, 'Phải ≥ 0')
    .max(200, 'Tối đa 200')
    .optional(),
  sortOrder: z.coerce.number({ message: 'Thứ tự phải là số' }).min(0).max(1000),
  status: z.enum(['active', 'disabled']),
  description: z.string().max(1000, 'Tối đa 1000 ký tự').optional(),
})
type VehicleTypeFormValues = z.input<typeof vehicleTypeSchema>

const emptyDefaults: VehicleTypeFormValues = {
  code: '',
  label: '',
  totalSeats: undefined,
  sortOrder: 0,
  status: 'active',
  description: '',
}

export function VehicleTypeFormDialog({
  open,
  vehicleType,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  vehicleType: AdminVehicleTypeOut | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const isEdit = !!vehicleType
  const createMutation = useCreateAdminVehicleType()
  const updateMutation = useUpdateAdminVehicleType()
  const saving = createMutation.isPending || updateMutation.isPending

  const form = useForm<VehicleTypeFormValues, unknown, VehicleTypeFormValues>({
    resolver: zodResolver(vehicleTypeSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: emptyDefaults,
  })

  const codeValue = form.watch('code')
  const labelValue = form.watch('label')

  useEffect(() => {
    if (open) {
      form.reset(
        vehicleType
          ? {
              code: vehicleType.code,
              label: vehicleType.label,
              totalSeats: vehicleType.totalSeats ?? undefined,
              sortOrder: vehicleType.sortOrder,
              status: (vehicleType.status as 'active' | 'disabled') ?? 'active',
              description: vehicleType.description ?? '',
            }
          : emptyDefaults,
      )
    }
  }, [open, vehicleType, form])

  // Auto-slug the code from the label while creating (only while the
  // code field is still pristine — the operator can override).
  useEffect(() => {
    if (!open || isEdit) return
    if (form.getFieldState('code').isDirty) return
    if (labelValue && !codeValue) {
      form.setValue('code', slugify(labelValue), { shouldDirty: true })
    }
  }, [open, isEdit, labelValue, codeValue, form])

  const onSubmit = async (values: VehicleTypeFormValues) => {
    try {
      const body: Record<string, unknown> = {
        code: values.code,
        label: values.label,
        totalSeats: values.totalSeats ?? null,
        sortOrder: values.sortOrder ?? 0,
        status: values.status,
        description: values.description || null,
      }
      if (isEdit) {
        await updateMutation.mutateAsync({ path: { id: vehicleType!.id }, body: body as any })
        toast.success('Đã cập nhật loại xe')
      } else {
        // SDK mutation hooks require { body: <payload> } (see schedule form).
        await createMutation.mutateAsync({ body: body as any })
        toast.success('Đã thêm loại xe mới')
      }
      onSaved()
    } catch (e: any) {
      toast.error(e?.error?.message ?? e?.message ?? 'Không thể lưu loại xe')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bus className="h-5 w-5 text-blue-600" />
            {isEdit ? 'Sửa loại xe' : 'Thêm loại xe mới'}
          </DialogTitle>
          <DialogDescription>
            Loại xe dùng trong form tạo lịch trình và bộ lọc tìm kiếm chuyến.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 items-start">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>
                      Mã <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="limousine"
                        className="font-mono text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>
                      Tên hiển thị <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder="Limousine" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-3 items-start">
              <FormField
                control={form.control}
                name="totalSeats"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>Số ghế thường</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="200"
                        value={field.value == null ? '' : String(field.value)}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        placeholder="29"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>Thứ tự hiển thị</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="1000"
                        value={field.value == null ? '0' : String(field.value)}
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
                name="status"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>Trạng thái</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Đang dùng</SelectItem>
                        <SelectItem value="disabled">Đã ẩn</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>Mô tả</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      rows={2}
                      placeholder="Ghi chú về loại xe (tùy chọn)"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={saving}>
                Huỷ
              </Button>
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang lưu...
                  </>
                ) : (
                  <>{isEdit ? 'Lưu thay đổi' : 'Thêm loại xe'}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
