'use client'

/**
 * QuickPickupPointDialog — inline creation of a pickup point directly
 * from the route form.
 *
 * Uses:
 *   - `reverse` from the generated SDK for reverse geocoding (no raw fetch).
 *   - `createPickupPointMutation` from the generated TanStack mutation
 *     for POST /api/admin/pickup-points (no raw fetch).
 *   - A single `form` state object instead of 8 separate useState calls.
 */

import { useState, useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ComboboxField } from '@/components/ui/combobox'
import { Plus, MapPin, Loader2, Crosshair } from 'lucide-react'
import { toast } from 'sonner'
import { LeafletMap, type PickedPlace } from '@/features/map/leaflet-map'
import { reverse as sdkReverse, create4 as createPickupPoint } from '@/lib/api/sdk.gen'
import { adminPickupPointsListQueryKey } from '@/lib/queries'
import { useT } from '@/lib/i18n'
import type { PlaceSearchHit } from '@/lib/api/types.gen'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  routeId?: string
  onCreated: (point: { id: string; name: string; lat?: number; lon?: number }) => void
}

// ── Form state shape (single object, not 8 separate useState calls) ──
type FormState = {
  name: string
  kind: string
  stopOrder: string
  lat: number | null
  lon: number | null
  address: string
}

const EMPTY_FORM: FormState = {
  name: '',
  kind: 'boarding',
  stopOrder: '',
  lat: null,
  lon: null,
  address: '',
}

export function QuickPickupPointDialog({ open, onOpenChange, routeId, onCreated }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [picked, setPicked] = useState<PickedPlace | null>(null)
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null)

  // ── Mutation: create pickup point via generated SDK ──────────
  const createMutation = useMutation({
    mutationFn: async (body: FormState) => {
      const { data } = await createPickupPoint({
        body: {
          name: body.name,
          kind: body.kind,
          lat: body.lat,
          lon: body.lon,
          address: body.address || undefined,
          stopOrder: body.stopOrder ? parseInt(body.stopOrder, 10) : undefined,
          routeId: routeId ?? undefined,
        },
      })
      return data
    },
    onSuccess: (data) => {
      toast.success(t('adminPickup.quickCreated'))
      // Refresh every pickup-points list (the generated list6 key is a
      // superset matcher for all routeId-scoped instances) so the
      // RoutePickupPointsDialog shows the new point immediately.
      qc.invalidateQueries({ queryKey: adminPickupPointsListQueryKey() })
      onCreated({
        id: data?.id ?? '',
        name: form.name,
        lat: form.lat ?? undefined,
        lon: form.lon ?? undefined,
      })
      setForm(EMPTY_FORM)
      setPicked(null)
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(t('adminPickup.createFailed'), {
        description: err?.message ?? t('adminPickup.tryAgain'),
      })
    },
  })

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      // Intentional effect-synced state (dialog reset-on-open /
      // server-data snapshot / DOM-availability gate).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(EMPTY_FORM)
      setPicked(null)
      setFlyTarget(null)
    }
  }, [open])

  // ── Map click → reverse geocode via generated SDK ────────────
  const handleMapClick = useCallback(async (clickLat: number, clickLon: number) => {
    setForm((f) => ({ ...f, lat: clickLat, lon: clickLon }))
    setPicked({ name: t('common.loading'), lat: clickLat, lon: clickLon })

    try {
      const { data } = await sdkReverse({ query: { lat: clickLat, lon: clickLon, limit: 1 } })
      const hits: PlaceSearchHit[] = (data ?? []) as PlaceSearchHit[]
      const hit = hits[0]
      if (hit) {
        const placeName = hit.name || `${clickLat.toFixed(3)}, ${clickLon.toFixed(3)}`
        setForm((f) => ({
          ...f,
          name: placeName,
          address: hit.name ? `${hit.name}, ${hit.province ?? ''}`.trim() : '',
        }))
        setPicked({ name: placeName, lat: clickLat, lon: clickLon, province: hit.province })
      } else {
        setForm((f) => ({ ...f, name: `${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}` }))
        setPicked({ name: t('map.selectedLocation'), lat: clickLat, lon: clickLon })
      }
    } catch {
      setForm((f) => ({ ...f, name: `${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}` }))
      setPicked({ name: t('map.selectedLocation'), lat: clickLat, lon: clickLon })
    }
  }, [t])

  // ── GPS "my location" ──────────────────────────────────────
  const handleMyLocation = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setFlyTarget([latitude, longitude])
        handleMapClick(latitude, longitude)
      },
      () => { },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [handleMapClick])

  // ── Submit ──────────────────────────────────────────────────
  const handleSave = () => {
    if (!form.name.trim()) {
      toast.error(t('adminPickup.nameRequired'))
      return
    }
    createMutation.mutate(form)
  }

  const saving = createMutation.isPending

  // Convenience accessor for form fields
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" /> {t('adminPickup.quickCreateTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('adminPickup.createDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Name + Kind */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('adminPickup.nameLabel')} <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder={t('adminPickup.namePh')}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">{t('adminPickup.kindLabel')}</Label>
              <div className="mt-1">
                <ComboboxField
                  value={form.kind}
                  onValueChange={(v) => update('kind', v)}
                  items={[
                    { value: 'boarding', label: t('adminPickup.kind.boarding') },
                    { value: 'dropping', label: t('adminPickup.kind.dropping') },
                    { value: 'both', label: t('adminPickup.kind.both') },
                  ]}
                  placeholder={t('adminPickup.chooseKind')}
                  searchPlaceholder={t('combobox.search')}
                  aria-label={t('adminPickup.kindLabel')}
                />
              </div>
            </div>
          </div>

          {/* Lat/Lng + Stop order */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">{t('adminPickup.latitude')}</Label>
              <Input
                value={form.lat ? form.lat.toFixed(6) : ''}
                readOnly
                placeholder={t('adminPickup.autoFromMap')}
                className="mt-1 bg-muted/30 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">{t('adminPickup.longitude')}</Label>
              <Input
                value={form.lon ? form.lon.toFixed(6) : ''}
                readOnly
                placeholder={t('adminPickup.autoFromMap')}
                className="mt-1 bg-muted/30 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">{t('adminPickup.stopOrderLabel')}</Label>
              <Input
                type="number"
                value={form.stopOrder}
                onChange={(e) => update('stopOrder', e.target.value)}
                placeholder={t('adminPickup.stopOrderPh')}
                className="mt-1"
              />
            </div>
          </div>

          {/* Map */}
          <div className="relative h-64 rounded-lg border overflow-hidden bg-slate-100">
            <LeafletMap
              className="h-full w-full"
              initialZoom={6}
              marker={picked ? { lat: picked.lat, lon: picked.lon, color: 'blue' } : null}
              onMapClick={handleMapClick}
              flyTarget={flyTarget}
              flyZoom={13}
            />
            {/* My location button */}
            <button
              onClick={handleMyLocation}
              className="absolute right-3 top-3 z-1000 h-9 w-9 rounded-lg bg-white/95 backdrop-blur ring-1 ring-slate-200 flex items-center justify-center text-primary hover:bg-primary/5 transition-colors"
              title={t('map.myLocation')}
              aria-label={t('map.myLocation')}
            >
              <Crosshair className="h-4 w-4" />
            </button>
            {/* Hint */}
            {!picked && (
              <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 rounded-full bg-slate-900/80 backdrop-blur px-4 py-2 text-xs font-medium text-white">
                <MapPin className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
                {t('map.clickToPick')}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            {t('adminPickup.createBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
