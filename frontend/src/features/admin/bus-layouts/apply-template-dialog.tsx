'use client'

import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adminBusLayoutsFitPlanMutation, type BusLayoutPreset, type SeatPlan } from '@/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'
import { PresetPicker } from '@/features/seat-plan'
import { usePresets } from './api'

/**
 * Pick a template for the plan being edited. For a saved layout the
 * server lays the template over the layout's existing seats (ids and
 * labels kept) and may refuse when the shapes cannot match; for a new
 * layout the template is used as-is.
 */
export function ApplyTemplateDialog({
  open,
  onOpenChange,
  layoutId,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Saved layout whose seats the template must fit; omit when creating. */
  layoutId?: string
  onApply: (plan: SeatPlan, preset: BusLayoutPreset) => void
}) {
  const t = useT()
  const presets = usePresets()
  const fit = useMutation(adminBusLayoutsFitPlanMutation())

  const pick = async (preset: BusLayoutPreset) => {
    try {
      const plan = layoutId
        ? await fit.mutateAsync({ path: { id: layoutId }, body: { presetId: preset.id } })
        : preset.plan
      onApply(plan, preset)
      onOpenChange(false)
    } catch (e) {
      toast.error(getErrorMessage(e, t('seatPlan.presets.applyFailed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !fit.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('seatPlan.presets.title')}</DialogTitle>
          <DialogDescription>
            {layoutId ? t('seatPlan.presets.fitDesc') : t('seatPlan.presets.desc')}
          </DialogDescription>
        </DialogHeader>
        <PresetPicker
          presets={presets.data?.items ?? []}
          loading={presets.isPending}
          busy={fit.isPending}
          onPick={pick}
        />
      </DialogContent>
    </Dialog>
  )
}
