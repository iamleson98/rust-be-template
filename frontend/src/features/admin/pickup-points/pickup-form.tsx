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
import { ComboboxField } from '@/components/ui/combobox'
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
import { useT } from '@/lib/i18n'
import type { AdminPickupPointOut, PlaceOut, AdminRouteOut } from '@/lib/api/types.gen'
import { getErrorMessage } from '@/lib/error-message'

// Schema factory — takes `t` so validation messages follow the UI language.
function makePickupPointSchema(t: ReturnType<typeof useT>) {
  return z.object({
    placeId: requiredText('adminPickup.placeLabel'),
    name: requiredText('adminPickup.displayName')
      .min(2, t('adminPickup.nameMin'))
      .max(120, t('adminPickup.nameMax')),
    stopOrder: positiveInt(0),
    etaOffsetMin: z.coerce
      .number({ message: t('adminPickup.etaNumber') })
      .int(t('adminPickup.etaInteger'))
      .min(0, t('adminPickup.etaMin')),
    pickupType: z.enum(['station', 'curb', 'on_request']),
    address: optionalText(1000),
  })
}
type PickupPointFormValues = z.infer<ReturnType<typeof makePickupPointSchema>>

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
  const t = useT()
  const isEdit = !!pickup
  const upsertMutation = useUpsertAdminPickupPoint()
  const saving = upsertMutation.isPending

  // Rebuilt per render so validation messages follow the UI language.
  const pickupPointSchema = makePickupPointSchema(t)

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
      toast.error(t('adminSchedules.noRouteSelected'))
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
      // SDK mutation hooks require { body: <payload> } — passing the raw
      // payload makes `opts.body === undefined`, which causes the openapi-ts
      // client to delete `Content-Type: application/json` before sending,
      // and axum's `Json<T>` extractor then returns 415 Unsupported Media Type.
      await upsertMutation.mutateAsync({ body: payload } as unknown as Parameters<typeof upsertMutation.mutateAsync>[0])
      toast.success(isEdit ? t('adminPickup.updated') : t('adminPickup.created'))
      onSaved()
    } catch (e) {
      toast.error(getErrorMessage(e, t('adminPickup.saveFailed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-rose-600" />
            {isEdit ? t('adminPickup.editTitle') : t('adminPickup.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {route ? (
              <>
                {t('adminSchedules.routePrefix')} <span className="font-medium">{route.name}</span>
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
                    {t('adminPickup.placeLabel')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <ComboboxField
                      value={field.value || null}
                      onValueChange={onSelectPlace}
                      items={sortedPlaces.map((p) => ({
                        value: p.id,
                        label: p.province ? `${p.name} · ${p.province}` : p.name,
                      }))}
                      placeholder={t('adminPickup.choosePlace')}
                      searchPlaceholder={t('adminPickup.searchPlace')}
                      contentClassName="max-h-70"
                      aria-label={t('adminPickup.placeLabel')}
                    />
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
                    {t('adminPickup.displayName')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('adminPickup.namePlaceholder')} />
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
                    <FormLabel>{t('adminPickup.stopOrder')}</FormLabel>
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
                    <FormLabel>{t('adminPickup.etaLabel')}</FormLabel>
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
                    <FormLabel>{t('adminPickup.pickupTypeLabel')}</FormLabel>
                    <FormControl>
                      <ComboboxField
                        value={field.value}
                        onValueChange={field.onChange}
                        items={[
                          { value: 'station', label: t('adminPickup.type.station') },
                          { value: 'curb', label: t('adminPickup.type.curb') },
                          { value: 'on_request', label: t('adminPickup.type.onRequest') },
                        ]}
                        placeholder={t('adminPickup.chooseType')}
                        searchPlaceholder={t('combobox.search')}
                        aria-label={t('adminPickup.pickupTypeLabel')}
                      />
                    </FormControl>
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
                  <FormLabel>{t('adminPickup.addressLabel')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      placeholder={t('adminPickup.addressPh')}
                      rows={2}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                  <>{isEdit ? t('common.saveChanges') : t('adminPickup.addPointBtn')}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
