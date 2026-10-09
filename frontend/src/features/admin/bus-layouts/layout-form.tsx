'use client'

import { useState } from 'react'
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query'
import { LayoutTemplate, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  adminBrandsListOptions,
  adminBusLayoutsCreateMutation,
  adminBusLayoutsReplacePlanMutation,
  adminBusLayoutsUpdateMutation,
  adminVehicleTypesListOptions,
  type BusLayoutPreset,
  type SeatPlan,
} from '@/api'
import { Button } from '@/components/ui/button'
import { ComboboxField } from '@/components/ui/combobox'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PlanEditor, sellableCount, usePlanEditor } from '@/features/seat-plan'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'
import { ApplyTemplateDialog } from './apply-template-dialog'

export type LayoutDraft = {
  /** Saved layout being edited; absent when creating. */
  id?: string
  name: string
  brandId: string
  vehicleType: string
  plan: SeatPlan
  /** Trips already sell the seats: they may move, never appear or vanish. */
  locked: boolean
  /** Saved before seat plans existed: the plan is a derived plain grid. */
  legacy: boolean
}

/** Details + seat plan editor for one layout; saves through create / update / replace-plan. */
export function LayoutForm({
  draft,
  onBusyChange,
  onCancel,
  onSaved,
}: {
  draft: LayoutDraft
  onBusyChange: (busy: boolean) => void
  onCancel: () => void
  onSaved: () => void
}) {
  const t = useT()
  const isEdit = !!draft.id
  const editor = usePlanEditor(draft.plan, draft.locked)
  const [name, setName] = useState(draft.name)
  const [brandId, setBrandId] = useState(draft.brandId)
  const [vehicleType, setVehicleType] = useState(draft.vehicleType)
  const [templateOpen, setTemplateOpen] = useState(false)

  const createMutation = useMutation(adminBusLayoutsCreateMutation())
  const updateMutation = useMutation(adminBusLayoutsUpdateMutation())
  const planMutation = useMutation(adminBusLayoutsReplacePlanMutation())
  const saving = createMutation.isPending || updateMutation.isPending || planMutation.isPending

  const brands = useQuery(adminBrandsListOptions()).data?.items ?? []
  const vehicleTypes =
    useQuery({
      ...adminVehicleTypesListOptions({ query: { limit: 100 } }),
      placeholderData: keepPreviousData,
    }).data?.items ?? []

  const detailsChanged =
    name.trim() !== draft.name || brandId !== draft.brandId || vehicleType !== draft.vehicleType

  const applyTemplate = (plan: SeatPlan, preset: BusLayoutPreset) => {
    editor.dispatch({ type: 'replace', plan })
    if (!isEdit) {
      if (!name.trim()) setName(preset.name)
      if (!vehicleType) setVehicleType(preset.vehicleType)
    }
    toast.success(t('seatPlan.presets.applied', { name: preset.name }))
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return toast.error(t('adminBusLayouts.nameRequired'))
    if (editor.issues.length) return toast.error(t(`seatPlan.issue.${editor.issues[0].code}`, editor.issues[0].params))
    onBusyChange(true)
    try {
      const details = { name: trimmed, brandId: brandId || null, vehicleType: vehicleType || null }
      if (!draft.id) {
        await createMutation.mutateAsync({ body: { ...details, plan: editor.state.plan } })
        toast.success(t('adminBusLayouts.createdWithSeats', { count: sellableCount(editor.state.plan) }))
      } else {
        // The plan goes first: it is the part the server may refuse (409).
        if (editor.dirty) {
          await planMutation.mutateAsync({ path: { id: draft.id }, body: { plan: editor.state.plan } })
        }
        if (detailsChanged) await updateMutation.mutateAsync({ path: { id: draft.id }, body: details })
        toast.success(t('busLayouts.updated'))
      }
      onSaved()
    } catch (e) {
      toast.error(getErrorMessage(e, t('adminBusLayouts.saveFailed')))
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? t('busLayouts.editTitle') : t('busLayouts.add')}</DialogTitle>
        <DialogDescription>{t(isEdit ? 'seatPlan.editDesc' : 'seatPlan.createDesc')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
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
              value={vehicleType || 'none'}
              onValueChange={(v) => setVehicleType(v === 'none' ? '' : v)}
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

        {draft.legacy && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            {t('seatPlan.legacy')}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('seatPlan.title')}</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => setTemplateOpen(true)}>
            <LayoutTemplate className="h-3.5 w-3.5" /> {t('seatPlan.presets.apply')}
          </Button>
        </div>
        <PlanEditor editor={editor} />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={save} disabled={saving || editor.issues.length > 0}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {t('common.saving')}
            </>
          ) : isEdit ? (
            t('common.saveChanges')
          ) : (
            t('adminBusLayouts.addButton')
          )}
        </Button>
      </DialogFooter>

      <ApplyTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        layoutId={draft.id}
        onApply={applyTemplate}
      />
    </>
  )
}
