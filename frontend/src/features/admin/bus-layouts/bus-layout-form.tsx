'use client'

/**
 * BusLayoutFormDialog — create/edit a bus layout.
 *
 * CREATE carries a seat-grid generator (floors × rows × cols) with a
 * live mini seat-map preview; the backend expands the grid into the
 * concrete `seat` rows the trip materializer sells. Labels follow the
 * Vietnamese convention the backend generates: `A1`–`D10` single deck,
 * `A01`–`A20`/`B01`–`B20` sleeper decks — the preview mirrors it.
 *
 * EDIT is metadata-only (name / brand / vehicle type): regenerating
 * seats on an existing layout would orphan per-trip seat inventory,
 * so the grid UI is create-only.
 */

import { useEffect, useMemo, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { ComboboxField } from '@/components/ui/combobox'
import { Armchair, Layers, Loader2, LayoutGrid } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminBrands, useAdminVehicleTypes, useUpsertAdminBusLayout, useUpdateAdminBusLayout } from '@/lib/queries'
import type { AdminBusLayoutOut } from '@/lib/api/types.gen'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'

/** Quick-pick presets that match the seeded vehicle-type catalog. */
const PRESETS: { labelKey: string; rows: number; cols: number; floors: number; vehicleCode: string }[] = [
  { labelKey: 'adminBusLayouts.presetLimousine9', rows: 3, cols: 3, floors: 1, vehicleCode: 'limousine' },
  { labelKey: 'adminBusLayouts.presetMinivan16', rows: 4, cols: 4, floors: 1, vehicleCode: 'minivan' },
  { labelKey: 'adminBusLayouts.presetSeater40', rows: 10, cols: 4, floors: 1, vehicleCode: 'standard' },
  { labelKey: 'adminBusLayouts.presetSleeper40', rows: 5, cols: 4, floors: 2, vehicleCode: 'sleeper' },
]

type GridState = { rows: number; cols: number; floors: number }

const DEFAULT_GRID: GridState = { rows: 10, cols: 4, floors: 1 }

export function BusLayoutFormDialog({
  open,
  layout,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  layout: AdminBusLayoutOut | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const t = useT()
  const isEdit = !!layout
  const createMutation = useUpsertAdminBusLayout()
  const updateMutation = useUpdateAdminBusLayout()
  const saving = createMutation.isPending || updateMutation.isPending

  const brandsQuery = useAdminBrands()
  const brands = (brandsQuery.data?.items ?? []) as { id: string; name: string; accentColor?: string | null }[]
  const vehicleTypesQuery = useAdminVehicleTypes({ limit: 100 })
  const vehicleTypes = (vehicleTypesQuery.data?.items ?? []) as {
    id: string
    code: string
    label: string
  }[]

  const [name, setName] = useState('')
  const [brandId, setBrandId] = useState('')
  const [vehicleCode, setVehicleCode] = useState('')
  const [grid, setGrid] = useState<GridState>(DEFAULT_GRID)

  useEffect(() => {
    if (open) {
      // Intentional effect-synced state (dialog reset-on-open — the
      // codebase's established pattern, see payment-dialog.tsx).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(layout?.name ?? '')
      setBrandId(layout?.brandId ?? '')
      setVehicleCode(layout?.vehicleType ?? '')
      setGrid(DEFAULT_GRID)
    }
  }, [open, layout])

  const totalSeats = grid.rows * grid.cols * grid.floors
  const seatLabels = useMemo(() => buildPreviewLabels(grid), [grid])

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setGrid({ rows: p.rows, cols: p.cols, floors: p.floors })
    setVehicleCode(p.vehicleCode)
  }

  const onSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error(t('adminBusLayouts.nameRequired'))
      return
    }
    try {
      if (isEdit) {
        await updateMutation.mutateAsync({
          path: { id: layout!.id },
          body: {
            name: trimmed,
            brandId: brandId || null,
            vehicleType: vehicleCode || null,
          },
        } as unknown as Parameters<typeof updateMutation.mutateAsync>[0])
        toast.success(t('busLayouts.updated'))
      } else {
        await createMutation.mutateAsync({
          body: {
            name: trimmed,
            brandId: brandId || null,
            vehicleType: vehicleCode || null,
            seatGrid: {
              rows: grid.rows,
              cols: grid.cols,
              floors: grid.floors,
            },
          },
        } as unknown as Parameters<typeof createMutation.mutateAsync>[0])
        toast.success(t('adminBusLayouts.createdWithSeats', { count: totalSeats }))
      }
      onSaved()
    } catch (e) {
      toast.error(getErrorMessage(e, t('adminBusLayouts.saveFailed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-600" />
            {isEdit ? t('busLayouts.editTitle') : t('busLayouts.add')}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? t('adminBusLayouts.editDesc')
              : t('adminBusLayouts.createDesc', { count: totalSeats })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="layout-name">
              {t('busLayouts.name')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="layout-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('busLayouts.namePh')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t('busLayouts.brand')}</Label>
              <ComboboxField
                value={brandId || 'none'}
                onValueChange={(v) => setBrandId(v === 'none' ? '' : v)}
                items={[
                  { value: 'none', label: t('busLayouts.noBrand') },
                  ...brands.map((b) => ({ value: b.id, label: b.name })),
                ]}
                placeholder={t('adminBusLayouts.chooseBrand')}
                searchPlaceholder={t('adminBusLayouts.searchBrand')}
                aria-label={t('busLayouts.brand')}
              />
            </div>

            <div className="grid gap-1.5">
              <Label>{t('busLayouts.vehicleType')}</Label>
              <ComboboxField
                value={vehicleCode || 'none'}
                onValueChange={(v) => setVehicleCode(v === 'none' ? '' : v)}
                items={[
                  { value: 'none', label: t('adminBusLayouts.notSelected') },
                  ...vehicleTypes.map((vt) => ({ value: vt.code, label: vt.label })),
                ]}
                placeholder={t('busLayouts.chooseVehicle')}
                searchPlaceholder={t('adminBusLayouts.searchVehicleType')}
                aria-label={t('busLayouts.vehicleType')}
              />
            </div>
          </div>

          {!isEdit && (
            <>
              {/* Presets */}
              <div>
                <Label className="mb-1.5 block">{t('busLayouts.presets')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.labelKey}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={cn(
                        'h-7 rounded-full border px-3 text-xs font-medium transition-colors',
                        grid.rows === p.rows &&
                          grid.cols === p.cols &&
                          grid.floors === p.floors
                          ? 'border-blue-400 bg-blue-50 text-blue-700'
                          : 'border-input text-muted-foreground hover:border-blue-300 hover:text-foreground',
                      )}
                    >
                      {t(p.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid dimensions */}
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="grid-rows">{t('adminBusLayouts.gridRows')}</Label>
                  <Input
                    id="grid-rows"
                    type="number"
                    min={1}
                    max={20}
                    value={grid.rows}
                    onChange={(e) => setGrid((g) => ({ ...g, rows: clampNum(e.target.value, 1, 20, g.rows) }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="grid-cols">{t('adminBusLayouts.gridCols')}</Label>
                  <Input
                    id="grid-cols"
                    type="number"
                    min={1}
                    max={6}
                    value={grid.cols}
                    onChange={(e) => setGrid((g) => ({ ...g, cols: clampNum(e.target.value, 1, 6, g.cols) }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="grid-floors">{t('busLayouts.floors')}</Label>
                  <div className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <ComboboxField
                      value={String(grid.floors)}
                      onValueChange={(v) => setGrid((g) => ({ ...g, floors: Number(v) }))}
                      items={[
                        { value: '1', label: t('busLayouts.floor1') },
                        { value: '2', label: t('busLayouts.floor2') },
                      ]}
                      className="flex-1"
                      aria-label={t('busLayouts.floors')}
                      data-testid="grid-floors"
                    />
                  </div>
                </div>
              </div>

              {/* Live seat-map preview */}
              <div className="rounded-lg border bg-slate-50/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Armchair className="h-3.5 w-3.5 text-blue-600" />
                    {t('busLayouts.preview')}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t('busLayouts.seatsTotal', { count: totalSeats, first: seatLabels[0] ?? '—' })}
                  </span>
                </div>
                <SeatGridPreview grid={grid} labels={seatLabels} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t('common.saving')}
              </>
            ) : (
              <>{isEdit ? t('common.saveChanges') : t('adminBusLayouts.addButton')}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Preview helpers (mirror the backend's generate_seat_grid) ── */

/** Labels the backend will generate for the grid — see
 *  `admin_service::generate_seat_grid` (must stay in sync). */
function buildPreviewLabels(grid: GridState): string[] {
  const labels: string[] = []
  for (let floor = 1; floor <= grid.floors; floor++) {
    for (let row = 1; row <= grid.rows; row++) {
      for (let col = 1; col <= grid.cols; col++) {
        if (grid.floors > 1) {
          const deckLetter = floor === 1 ? 'A' : 'B'
          labels.push(`${deckLetter}${String((row - 1) * grid.cols + col).padStart(2, '0')}`)
        } else {
          const letter = String.fromCharCode('A'.charCodeAt(0) + col - 1)
          labels.push(`${letter}${row}`)
        }
      }
    }
  }
  return labels
}

/** Mini seat-map preview: rows with an aisle gap after column 2 when
 *  the grid is 4+ seats wide (matches the customer-facing seat map). */
function SeatGridPreview({ grid, labels }: { grid: GridState; labels: string[] }) {
  const t = useT()
  let idx = 0
  return (
    <div className="space-y-2">
      {Array.from({ length: grid.floors }).map((_, f) => (
        <div key={f} className="rounded-md border bg-white p-2">
          {grid.floors > 1 && (
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {f === 0 ? t('adminBusLayouts.lowerDeck') : t('adminBusLayouts.upperDeck')}
            </div>
          )}
          <div className="flex justify-center">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-0.5 text-[10px] font-semibold text-white">
              {t('adminBusLayouts.driver')}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            {Array.from({ length: grid.rows }).map((_, r) => (
              <div key={r} className="flex items-center gap-1">
                <span className="w-4 text-right text-[9px] text-slate-400">{r + 1}</span>
                {Array.from({ length: grid.cols }).map((_, c) => {
                  const label = labels[idx++] ?? ''
                  return (
                    <span key={c} className="flex items-center">
                      {/* Aisle gap after column 2 on 4+ wide grids */}
                      {grid.cols >= 4 && c === 2 && <span className="w-3" aria-hidden />}
                      <span
                        className="flex h-6 w-9 items-center justify-center rounded border border-slate-300 bg-white text-[9px] font-bold text-slate-600"
                        title={label}
                      >
                        {label}
                      </span>
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Parse a number input, falling back to the previous value when
 *  blank/invalid and clamping into [min, max]. */
function clampNum(raw: string, min: number, max: number, prev: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return prev
  return Math.min(max, Math.max(min, Math.trunc(n)))
}
