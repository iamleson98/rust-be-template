'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminBusLayoutsDetailOptions, type AdminBusLayoutOut, type BusLayoutPreset } from '@/api'
import { ErrorState } from '@/components/error-state'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { PresetPicker, blankPlan } from '@/features/seat-plan'
import { useT } from '@/lib/i18n'
import { usePresets } from './api'
import { LayoutForm, type LayoutDraft } from './layout-form'

type Props = {
  open: boolean
  /** Layout to edit; `null` creates a new one. */
  layout: AdminBusLayoutOut | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

/** Create (template gallery → editor) or edit (saved plan → editor) a bus layout. */
export function BusLayoutDialog({ open, layout, onOpenChange, onSaved }: Props) {
  const [busy, setBusy] = useState(false)
  const body = { onBusyChange: setBusy, onCancel: () => onOpenChange(false), onSaved }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[94dvh] max-w-6xl overflow-y-auto">
        {open && (layout ? <EditLayout id={layout.id} {...body} /> : <CreateLayout {...body} />)}
      </DialogContent>
    </Dialog>
  )
}

type BodyProps = Omit<Props, 'open' | 'layout' | 'onOpenChange'> & {
  onBusyChange: (busy: boolean) => void
  onCancel: () => void
}

function CreateLayout(props: BodyProps) {
  const t = useT()
  const presets = usePresets()
  const [draft, setDraft] = useState<LayoutDraft | null>(null)

  const start = (plan: LayoutDraft['plan'], preset?: BusLayoutPreset) =>
    setDraft({
      name: preset?.name ?? '',
      brandId: '',
      vehicleType: preset?.vehicleType ?? '',
      plan,
      locked: false,
      legacy: false,
    })

  if (draft) return <LayoutForm draft={draft} {...props} />
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('busLayouts.add')}</DialogTitle>
        <DialogDescription>{t('seatPlan.presets.desc')}</DialogDescription>
      </DialogHeader>
      <PresetPicker
        presets={presets.data?.items ?? []}
        loading={presets.isPending}
        onPick={(p) => start(p.plan, p)}
        onBlank={() => start(blankPlan())}
      />
    </>
  )
}

function EditLayout({ id, ...props }: BodyProps & { id: string }) {
  const t = useT()
  const detail = useQuery(adminBusLayoutsDetailOptions({ path: { id } }))

  if (detail.isError) {
    return (
      <>
        <DialogTitle className="sr-only">{t('busLayouts.editTitle')}</DialogTitle>
        <ErrorState description={t('seatPlan.loadFailed')} onRetry={() => detail.refetch()} />
      </>
    )
  }
  if (!detail.data) {
    return (
      <>
        <DialogTitle className="sr-only">{t('busLayouts.editTitle')}</DialogTitle>
        <Skeleton className="h-96 w-full rounded-lg" />
      </>
    )
  }
  const d = detail.data
  return (
    <LayoutForm
      draft={{
        id,
        name: d.name ?? '',
        brandId: d.brandId ?? '',
        vehicleType: d.vehicleType ?? '',
        plan: d.plan,
        locked: d.inUse,
        legacy: !d.planned,
      }}
      {...props}
    />
  )
}
