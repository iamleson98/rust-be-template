'use client'

import { useMutation } from '@tanstack/react-query'
import { adminBrandsCreateMutation, adminBrandsUpdateMutation } from '@/api'
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
import { Switch } from '@/components/ui/switch'
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
import { Baby, Building2, Phone, Mail, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { optionalText } from '@/lib/forms'
import { formatVND } from '@/lib/format'
import type { AdminBrandOut, UpsertBrandRequest } from '@/api'
import { slugify } from '@/lib/text'
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
    description: optionalText(5000),
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
    /** Child tickets: who counts as a child and how much less they pay. */
    childFare: z.object({
      enabled: z.boolean(),
      maxAge: z
        .number()
        .int()
        .min(1, t('brandForm.childAgeRange'))
        .max(17, t('brandForm.childAgeRange')),
      discountPercent: z
        .number()
        .int()
        .min(0, t('brandForm.childDiscountRange'))
        .max(100, t('brandForm.childDiscountRange')),
    }),
  })
type BrandFormValues = z.infer<ReturnType<typeof makeBrandSchema>>

const NO_CHILD_FARE = { enabled: false, maxAge: 10, discountPercent: 25 }
/** The adult fare the form's example applies the discount to. */
const EXAMPLE_FARE = 300_000

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
  const createMutation = useMutation(adminBrandsCreateMutation())
  const updateMutation = useMutation(adminBrandsUpdateMutation())
  const saving = createMutation.isPending || updateMutation.isPending
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
      childFare: NO_CHILD_FARE,
    },
  })

  const nameValue = form.watch('name')
  const childFare = form.watch('childFare')

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
        childFare: brand?.childFare ? { enabled: true, ...brand.childFare } : NO_CHILD_FARE,
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
      const body: UpsertBrandRequest = {
        name: values.name.trim(),
        slug: values.slug.trim(),
        description: (values.description ?? '').trim(),
        contactPhone: (values.contactPhone ?? '').trim(),
        contactEmail: (values.contactEmail ?? '').trim(),
        accentColor: values.accentColor,
        status: values.status,
        childFare: values.childFare.enabled
          ? {
              maxAge: values.childFare.maxAge,
              discountPercent: values.childFare.discountPercent,
            }
          : null,
      }
      if (isEdit) await updateMutation.mutateAsync({ path: { id: brand!.id }, body })
      else await createMutation.mutateAsync({ body })
      toast.success(isEdit ? t('brandForm.updated') : t('brandForm.created'))
      onSaved()
    } catch (e) {
      toast.error(getErrorMessage(e, t('brandForm.saveFailed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-rose-600" />
            {isEdit ? t('brandForm.editTitle') : t('brandForm.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('brandForm.description')}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3">
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
                      className="font-mono text-base md:text-xs"
                      onChange={(e) => {
                        field.onChange(e)
                        setSlugTouched(true)
                      }}
                    />
                  </FormControl>
                  <p className="text-[11px] text-muted-foreground">{t('brandForm.slugHint')}</p>
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
                          className="font-mono text-base md:text-xs flex-1"
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

            <fieldset className="rounded-lg border p-3 space-y-3">
              <FormField
                control={form.control}
                name="childFare.enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 space-y-0">
                    <div>
                      <FormLabel className="flex items-center gap-1.5">
                        <Baby className="h-4 w-4 text-amber-600" /> {t('brandForm.childFare')}
                      </FormLabel>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {t('brandForm.childFareHint')}
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {childFare.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-3 items-start">
                    <FormField
                      control={form.control}
                      name="childFare.maxAge"
                      render={({ field }) => (
                        <FormItem className="grid gap-1.5">
                          <FormLabel>{t('brandForm.childMaxAge')}</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={1}
                              max={17}
                              value={field.value}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="childFare.discountPercent"
                      render={({ field }) => (
                        <FormItem className="grid gap-1.5">
                          <FormLabel>{t('brandForm.childDiscount')}</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              value={field.value}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('brandForm.childFareExample', {
                      age: childFare.maxAge,
                      adult: formatVND(EXAMPLE_FARE),
                      child: formatVND(
                        Math.round(
                          (EXAMPLE_FARE * (100 - childFare.discountPercent)) / 100 / 1000,
                        ) * 1000,
                      ),
                    })}
                  </p>
                </>
              )}
            </fieldset>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving} className="bg-rose-600 hover:bg-rose-700">
                {saving ? (
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
