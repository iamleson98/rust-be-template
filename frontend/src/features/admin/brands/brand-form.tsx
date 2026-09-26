'use client'

/**
 * BrandFormDialog — create/edit a Brand record.
 *
 * Migrated from manual `fetch` POST/PUT to the `useUpsertAdminBrand()`
 * TanStack Query mutation. The mutation auto-invalidates the brands list
 * query (both admin and public) on success, so the parent list refreshes
 * without manual refetch calls.
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
import { Textarea } from '@/components/ui/textarea'
import { ComboboxField } from '@/components/ui/combobox'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Building2, Phone, Mail, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { optionalText } from '@/lib/forms'
import { useUpsertAdminBrand } from '@/lib/queries'
import type { AdminBrandOut } from '@/lib/api'
import { slugify } from './helpers'
import { getErrorMessage } from '@/lib/error-message'

const makeBrandSchema = (t: ReturnType<typeof useT>) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t('adminBrands.nameRequired'))
      .min(2, t('adminBrands.nameMin'))
      .max(60, t('adminBrands.nameMax')),
    slug: z
      .string()
      .trim()
      .min(1, t('adminBrands.slugRequired'))
      .max(80, t('adminBrands.slugMax'))
      .regex(/^[a-z0-9-]+$/, t('adminBrands.slugRegex')),
    // Backend allows max 5000 chars for description.
    description: optionalText(5000),
    // contactPhone + contactEmail are OPTIONAL in the backend
    // (`UpsertBrandRequest` marks them Optional). The previous version
    // used `requiredText(...)` which marked them as required in the UI
    // — misleading. Changed to optional with format validation only.
    contactPhone: z
      .string()
      .trim()
      .optional()
      .or(z.literal(''))
      .refine((v) => !v || /^0\d{8,10}$/.test(v), t('validation.phone')),
    contactEmail: z
      .string()
      .trim()
      .optional()
      .or(z.literal(''))
      .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), t('validation.email')),
    accentColor: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, t('adminBrands.hexInvalid')),
    status: z.enum(['active', 'inactive']),
  })
type BrandFormValues = z.infer<ReturnType<typeof makeBrandSchema>>

export function BrandFormDialog({
  open,
  brand,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  brand: AdminBrandOut | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const t = useT()
  const isEdit = !!brand
  const [slugTouched, setSlugTouched] = useState(false)
  const upsertMutation = useUpsertAdminBrand()
  const brandSchema = useMemo(() => makeBrandSchema(t), [t])

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
      form.setValue('slug', slugify(nameValue))
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
      await upsertMutation.mutateAsync({ body: payload } as unknown as Parameters<typeof upsertMutation.mutateAsync>[0])
      toast.success(isEdit ? t('brandForm.updated') : t('brandForm.created'))
      onSaved()
    } catch (e) {
      toast.error(getErrorMessage(e, t('brandForm.saveFailed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !upsertMutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-rose-600" />
            {isEdit ? t('brandForm.editTitle') : t('brandForm.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('brandForm.description')}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-3"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="grid gap-1.5">
                  <FormLabel>
                    {t('brandForm.name')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('brandForm.namePh')} />
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
                    {t('brandForm.slug')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t('brandForm.slugPh')}
                      className="font-mono text-xs"
                      onChange={(e) => {
                        field.onChange(e)
                        setSlugTouched(true)
                      }}
                    />
                  </FormControl>
                  <p className="text-[11px] text-muted-foreground">
                    {t('brandForm.slugHint')}
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
                  <FormLabel>{t('brandForm.descriptionField')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      placeholder={t('adminBrands.descriptionPh')}
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3 items-start">
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel className="flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" /> {t('brandForm.hotline')}
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
                      <Mail className="h-3.5 w-3.5" /> {t('brandForm.email')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder="info@brand.vn" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 items-start">
              <FormField
                control={form.control}
                name="accentColor"
                render={({ field }) => (
                  <FormItem className="grid gap-1.5">
                    <FormLabel>{t('brandForm.accentColor')}</FormLabel>
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
                    <FormLabel>{t('common.status')}</FormLabel>
                    <FormControl>
                      <ComboboxField
                        value={field.value}
                        onValueChange={field.onChange}
                        items={[
                          { value: 'active', label: t('common.active') },
                          { value: 'inactive', label: t('common.inactive') },
                        ]}
                        placeholder={t('adminBrands.chooseStatus')}
                        searchPlaceholder={t('combobox.search')}
                        aria-label={t('common.status')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upsertMutation.isPending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={upsertMutation.isPending} className="bg-rose-600 hover:bg-rose-700">
                {upsertMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> {t('common.saving')}
                  </>
                ) : (
                  <>{isEdit ? t('common.saveChanges') : t('brands.addBrand')}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
