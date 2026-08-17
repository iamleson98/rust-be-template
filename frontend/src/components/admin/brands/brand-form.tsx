'use client'

/**
 * BrandFormDialog — create/edit a Brand record.
 *
 * Migrated from manual `fetch` POST/PUT to the `useUpsertAdminBrand()`
 * TanStack Query mutation. The mutation auto-invalidates the brands list
 * query (both admin and public) on success, so the parent list refreshes
 * without manual refetch calls.
 */

import { useEffect, useState } from 'react'
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
import { Building2, Phone, Mail, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { requiredText, optionalText } from '@/lib/forms'
import { useUpsertAdminBrand } from '@/lib/queries'
import type { AdminBrandRow as Brand } from '@/components/admin/types'
import { slugify } from './helpers'

const brandSchema = z.object({
  name: requiredText('Tên hãng xe')
    .min(2, 'Tên hãng cần ít nhất 2 ký tự')
    .max(60, 'Tên hãng tối đa 60 ký tự'),
  slug: requiredText('Slug')
    .max(80, 'Slug tối đa 80 ký tự')
    .regex(/^[a-z0-9-]+$/, 'Slug chỉ chứa chữ thường, số và dấu gạch ("-")'),
  description: optionalText(500),
  contactPhone: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || /^0\d{8,10}$/.test(v), 'Số điện thoại không hợp lệ (vd: 0912345678)'),
  contactEmail: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email không hợp lệ'),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Mã hex hợp lệ: #RRGGBB'),
  status: z.enum(['active', 'inactive']),
})
type BrandFormValues = z.infer<typeof brandSchema>

export function BrandFormDialog({
  open,
  brand,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  brand: Brand | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const isEdit = !!brand
  const [slugTouched, setSlugTouched] = useState(false)
  const upsertMutation = useUpsertAdminBrand()

  const form = useForm<BrandFormValues>({
    resolver: zodResolver(brandSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      contactPhone: '',
      contactEmail: '',
      accentColor: '#0d9488',
      status: 'active',
    },
  })

  const nameValue = form.watch('name')

  // Populate form when dialog opens / record changes
  useEffect(() => {
    if (open) {
      setSlugTouched(false)
      form.reset({
        name: brand?.name ?? '',
        slug: brand?.slug ?? '',
        description: brand?.description ?? '',
        contactPhone: brand?.contactPhone ?? '',
        contactEmail: brand?.contactEmail ?? '',
        accentColor: brand?.accentColor ?? '#0d9488',
        status: brand?.status === 'inactive' ? 'inactive' : 'active',
      })
    }
  }, [open, brand, form])

  // Auto-suggest slug from name when adding new or slug not manually touched
  useEffect(() => {
    if (open && !isEdit && !slugTouched) {
      form.setValue('slug', slugify(nameValue ?? ''))
    }
  }, [nameValue, isEdit, slugTouched, open, form])

  const onSubmit = async (values: BrandFormValues) => {
    try {
      const payload: Record<string, unknown> = {
        name: values.name.trim(),
        slug: values.slug.trim(),
        description: (values.description ?? '').trim(),
        contactPhone: (values.contactPhone ?? '').trim(),
        contactEmail: (values.contactEmail ?? '').trim(),
        accentColor: values.accentColor,
        status: values.status,
      }
      if (isEdit) {
        payload.id = brand!.id
      }
      await upsertMutation.mutateAsync(payload as any)
      toast.success(isEdit ? 'Đã cập nhật hãng xe' : 'Đã thêm hãng xe mới')
      onSaved()
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể lưu hãng xe')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !upsertMutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-rose-600" />
            {isEdit ? 'Sửa hãng xe' : 'Thêm hãng xe mới'}
          </DialogTitle>
          <DialogDescription>
            Nhập thông tin hãng vận hành. Các trường đánh dấu * là bắt buộc.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-3 max-h-[60vh] overflow-y-auto pr-1"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    Tên hãng xe <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="VD: Phương Trang Express" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    Slug <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="phuong-trang-express"
                      className="font-mono text-xs"
                      onChange={(e) => {
                        field.onChange(e)
                        setSlugTouched(true)
                      }}
                    />
                  </FormControl>
                  <p className="text-[11px] text-muted-foreground">
                    Tự động tạo từ tên. Phải là duy nhất.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                      placeholder="Mô tả ngắn về hãng xe..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel className="flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" /> Hotline
                    </FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder="1900 6067" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel className="flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5" /> Email
                    </FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder="info@brand.vn" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="accentColor"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>Màu thương hiệu</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={field.value ?? '#0d9488'}
                          onChange={field.onChange}
                          className="h-9 w-12 rounded border cursor-pointer"
                        />
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          className="font-mono text-xs flex-1"
                        />
                      </div>
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
                        <SelectItem value="active">
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" /> Hoạt động
                          </span>
                        </SelectItem>
                        <SelectItem value="inactive">Ẩn</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upsertMutation.isPending}>
                Huỷ
              </Button>
              <Button type="submit" disabled={upsertMutation.isPending} className="bg-rose-600 hover:bg-rose-700">
                {upsertMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang lưu...
                  </>
                ) : (
                  <>{isEdit ? 'Lưu thay đổi' : 'Thêm hãng xe'}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
