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
import { ComboboxField } from '@/components/ui/combobox'
import { Bus, Loader2 } from 'lucide-react'
import { useCreateAdminVehicleType, useUpdateAdminVehicleType } from '@/lib/queries'
import { slugify } from '@/lib/slug'
import type { AdminVehicleTypeOut } from '@/lib/api/types.gen'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'

/** Schema factory — messages follow the active UI language. */
const buildVehicleTypeSchema = (t: ReturnType<typeof useT>) =>
  z.object({
    code: z
      .string()
      .trim()
      .min(1, t('adminVehicleTypes.codeRequired'))
      .min(2, t('adminVehicleTypes.codeMin'))
      .max(60, t('adminVehicleTypes.codeMax'))
      .regex(/^[a-z0-9-]+$/, t('adminVehicleTypes.codeRegex')),
    label: z
      .string()
      .trim()
      .min(1, t('adminVehicleTypes.labelRequired'))
      .min(2, t('adminVehicleTypes.labelMin'))
      .max(120),
    totalSeats: z.coerce
      .number({ message: t('adminVehicleTypes.seatsNumber') })
      .min(0, t('adminVehicleTypes.seatsMin'))
      .max(200, t('adminVehicleTypes.seatsMax'))
      .optional(),
    sortOrder: z.coerce.number({ message: t('adminVehicleTypes.sortNumber') }).min(0).max(1000),
    status: z.enum(['active', 'disabled']),
    description: z.string().max(1000, t('adminVehicleTypes.descMax')).optional(),
  })
type VehicleTypeFormValues = z.input<ReturnType<typeof buildVehicleTypeSchema>>

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
  const t = useT()
  const isEdit = !!vehicleType
  const createMutation = useCreateAdminVehicleType()
  const updateMutation = useUpdateAdminVehicleType()
  const saving = createMutation.isPending || updateMutation.isPending

  const form = useForm<VehicleTypeFormValues, unknown, VehicleTypeFormValues>({
    resolver: zodResolver(buildVehicleTypeSchema(t)),
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
        await updateMutation.mutateAsync({
        path: { id: vehicleType!.id },
        body,
      } as unknown as Parameters<typeof updateMutation.mutateAsync>[0])
        toast.success(t('adminVehicleTypes.updated'))
      } else {
        // SDK mutation hooks require { body: <payload> } (see schedule form).
        await createMutation.mutateAsync({ body } as unknown as Parameters<typeof createMutation.mutateAsync>[0])
        toast.success(t('adminVehicleTypes.created'))
      }
      onSaved()
    } catch (e) {
      toast.error(getErrorMessage(e, t('adminVehicleTypes.saveFailed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bus className="h-5 w-5 text-blue-600" />
            {isEdit ? t('adminVehicleTypes.editTitle') : t('adminVehicleTypes.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('adminVehicleTypes.formDesc')}
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
                      {t('adminVehicleTypes.code')} <span className="text-destructive">*</span>
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
                      {t('adminVehicleTypes.displayName')} <span className="text-destructive">*</span>
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
                    <FormLabel>{t('adminVehicleTypes.seatsLabel')}</FormLabel>
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
                    <FormLabel>{t('adminVehicleTypes.sortOrderLabel')}</FormLabel>
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
                    <FormLabel>{t('common.status')}</FormLabel>
                    <ComboboxField
                      value={field.value}
                      onValueChange={field.onChange}
                      items={[
                        { value: 'active', label: t('adminVehicleTypes.active') },
                        { value: 'disabled', label: t('adminVehicleTypes.disabled') },
                      ]}
                      placeholder={t('adminVehicleTypes.chooseStatus')}
                      searchPlaceholder={t('combobox.search')}
                      aria-label={t('common.status')}
                    />
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
                  <FormLabel>{t('adminVehicleTypes.description')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      rows={2}
                      placeholder={t('adminVehicleTypes.descPlaceholder')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> {t('common.saving')}
                  </>
                ) : (
                  <>{isEdit ? t('common.saveChanges') : t('adminVehicleTypes.add')}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
