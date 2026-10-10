import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Loader2, Lock, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  adminBrandsListOptions,
  adminCampaignsCreateMutation,
  adminCampaignsUpdateMutation,
  type AdminCampaignOut,
} from '@/api'
import { Segmented } from '@/components/console/segmented'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/lib/error-message'
import { formatNum, useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { noTones } from '@/lib/text'
import { cn } from '@/lib/utils'
import {
  budgetOf,
  draftOf,
  emptyDraft,
  hasErrors,
  inputOf,
  locks,
  MAX_TIERS,
  newTier,
  validateDraft,
  type CampaignDraft,
  type TierDraft,
} from './form'

/** What the editor opens on: a campaign to edit (or none, to create) and the moment it opened. */
export type EditorTarget = { campaign: AdminCampaignOut | null; now: number; nonce: number }

/** Create or edit a campaign in a side sheet, within the rules of a running one. */
export function CampaignEditor({
  target,
  onClose,
}: {
  target: EditorTarget | null
  onClose: () => void
}) {
  const t = useT()
  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>
            {target?.campaign ? t('adminCampaigns.edit') : t('adminCampaigns.new')}
          </SheetTitle>
          <SheetDescription>{t('adminCampaigns.editorHint')}</SheetDescription>
        </SheetHeader>
        {target && <EditorBody key={target.nonce} target={target} onDone={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function EditorBody({ target, onDone }: { target: EditorTarget; onDone: () => void }) {
  const t = useT()
  const money = useMoney()
  const original = target.campaign ?? undefined
  const [draft, setDraft] = useState<CampaignDraft>(() =>
    original ? draftOf(original) : emptyDraft(target.now),
  )
  const [showErrors, setShowErrors] = useState(false)
  const create = useMutation(adminCampaignsCreateMutation())
  const update = useMutation(adminCampaignsUpdateMutation())
  const saving = create.isPending || update.isPending

  const locked = locks(original, target.now)
  const errors = validateDraft(draft, original, target.now)
  const shown = showErrors ? errors : {}
  const set = (patch: Partial<CampaignDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const setTier = (key: string, patch: Partial<TierDraft>) =>
    set({ tiers: draft.tiers.map((tier) => (tier.key === key ? { ...tier, ...patch } : tier)) })

  const save = () => {
    setShowErrors(true)
    if (hasErrors(errors)) return
    const body = inputOf(draft, original)
    const done = {
      onSuccess: () => {
        toast.success(t('adminCampaigns.saved'))
        onDone()
      },
      onError: (e: unknown) => toast.error(getErrorMessage(e)),
    }
    if (original) update.mutate({ path: { id: original.id }, body }, done)
    else create.mutate({ body }, done)
  }

  return (
    <>
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <Field label={t('adminCampaigns.fieldName')} error={shown.name && t(shown.name)}>
          <Input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={120}
            placeholder={t('adminCampaigns.namePh')}
          />
        </Field>
        <Field
          label={t('adminCampaigns.fieldDescription')}
          error={shown.description && t(shown.description)}
        >
          <Textarea
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={2}
            maxLength={1000}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('adminCampaigns.fieldStart')}
            error={shown.startsAt && t(shown.startsAt)}
            hint={locked.start ? t('adminCampaigns.startLocked') : undefined}
          >
            <Input
              type="datetime-local"
              value={draft.startsAt}
              onChange={(e) => set({ startsAt: e.target.value })}
              disabled={locked.start}
            />
          </Field>
          <Field label={t('adminCampaigns.fieldEnd')} error={shown.endsAt && t(shown.endsAt)}>
            <Input
              type="datetime-local"
              value={draft.endsAt}
              onChange={(e) => set({ endsAt: e.target.value })}
            />
          </Field>
        </div>

        <Field
          label={t('adminCampaigns.fieldValidity')}
          hint={locked.validity ? t('adminCampaigns.validityLocked') : undefined}
        >
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {(['campaign', 'permanent'] as const).map((v) => (
              <Choice
                key={v}
                selected={draft.couponValidity === v}
                disabled={locked.validity}
                onSelect={() => set({ couponValidity: v })}
                title={t(
                  v === 'campaign'
                    ? 'adminCampaigns.validityCampaign'
                    : 'adminCampaigns.validityPermanent',
                )}
                body={t(
                  v === 'campaign'
                    ? 'adminCampaigns.validityCampaignHint'
                    : 'adminCampaigns.validityPermanentHint',
                )}
              />
            ))}
          </div>
        </Field>

        <Field label={t('adminCampaigns.fieldOperators')} error={shown.brands && t(shown.brands)}>
          <Segmented
            label={t('adminCampaigns.fieldOperators')}
            value={draft.allBrands ? 'all' : 'some'}
            onChange={(v) => set({ allBrands: v === 'all' })}
            options={[
              { value: 'all', label: t('adminCampaigns.allOperators') },
              { value: 'some', label: t('adminCampaigns.someOperators') },
            ]}
          />
          {!draft.allBrands && (
            <BrandPicker selected={draft.brandIds} onChange={(brandIds) => set({ brandIds })} />
          )}
        </Field>

        <Field label={t('adminCampaigns.fieldTiers')} error={shown.tiers && t(shown.tiers)}>
          <div className="space-y-2">
            {draft.tiers.map((tier) => {
              const err = shown.tierRows?.[tier.key]
              return (
                <div key={tier.key}>
                  <div className="flex items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Input
                        inputMode="numeric"
                        aria-label={t('adminCampaigns.tierAmount')}
                        placeholder={t('adminCampaigns.tierAmount')}
                        value={tier.amount ? formatNum(Number(tier.amount)) : ''}
                        onChange={(e) =>
                          setTier(tier.key, {
                            amount: e.target.value.replace(/\D/g, '').slice(0, 9),
                          })
                        }
                        disabled={tier.claimed > 0}
                        className="pr-7 tabular-nums"
                        aria-invalid={!!err}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                        ₫
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground" aria-hidden>
                      ×
                    </span>
                    <Input
                      inputMode="numeric"
                      aria-label={t('adminCampaigns.tierSlots')}
                      placeholder={t('adminCampaigns.tierSlots')}
                      value={tier.slots ? formatNum(Number(tier.slots)) : ''}
                      onChange={(e) =>
                        setTier(tier.key, { slots: e.target.value.replace(/\D/g, '').slice(0, 7) })
                      }
                      className="w-28 tabular-nums sm:w-32"
                      aria-invalid={!!err}
                    />
                    {tier.claimed > 0 ? (
                      <span
                        className="grid size-9 shrink-0 place-items-center text-muted-foreground"
                        title={t('adminCampaigns.tierLocked', { count: tier.claimed })}
                      >
                        <Lock
                          className="size-4"
                          aria-label={t('adminCampaigns.tierLocked', { count: tier.claimed })}
                        />
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-rose-600"
                        onClick={() =>
                          set({ tiers: draft.tiers.filter((x) => x.key !== tier.key) })
                        }
                        disabled={draft.tiers.length === 1}
                        aria-label={t('adminCampaigns.removeTier')}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  {tier.claimed > 0 && !err && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('adminCampaigns.tierLocked', { count: tier.claimed })}
                    </p>
                  )}
                  {err && (
                    <p className="mt-1 text-xs text-destructive">
                      {t(err.key, { count: err.count ?? 0 })}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => set({ tiers: [...draft.tiers, newTier()] })}
              disabled={draft.tiers.length >= MAX_TIERS}
            >
              <Plus />
              {t('adminCampaigns.addTier')}
            </Button>
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {t('adminCampaigns.budgetLive', { amount: money(budgetOf(draft)) })}
            </span>
          </div>
        </Field>

        <button
          type="button"
          role="switch"
          aria-checked={draft.paused}
          onClick={() => set({ paused: !draft.paused })}
          className="flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left hover:bg-muted/50"
        >
          <span>
            <span className="block text-sm font-medium">{t('adminCampaigns.fieldPaused')}</span>
            <span className="block text-xs text-muted-foreground">
              {t('adminCampaigns.pausedHint')}
            </span>
          </span>
          <span
            aria-hidden
            className={cn(
              'flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
              draft.paused ? 'bg-amber-500' : 'bg-slate-300',
            )}
          >
            <span
              className={cn(
                'size-4 rounded-full bg-white shadow-sm transition-transform',
                draft.paused && 'translate-x-4',
              )}
            />
          </span>
        </button>
      </div>

      <SheetFooter className="flex-row justify-end border-t bg-background">
        <Button variant="outline" onClick={onDone} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {original ? t('adminCampaigns.save') : t('adminCampaigns.create')}
        </Button>
      </SheetFooter>
    </>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | false
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

/** A radio card: a title and one line on what it means. */
function Choice({
  selected,
  disabled,
  onSelect,
  title,
  body,
}: {
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        selected ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : 'hover:bg-muted/50',
      )}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
    </button>
  )
}

/** Operators as a searchable checklist. */
function BrandPicker({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const brands = useQuery(adminBrandsListOptions()).data?.items
  const shown = useMemo(() => {
    const needle = noTones(q)
    return (brands ?? []).filter((b) => !needle || noTones(b.name).includes(needle))
  }, [brands, q])
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  return (
    <div className="mt-3 rounded-xl border">
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('adminCampaigns.searchOperator')}
          aria-label={t('adminCampaigns.searchOperator')}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {t('adminCampaigns.selectedCount', { count: selected.length })}
        </span>
      </div>
      <div className="max-h-56 overflow-y-auto p-1">
        {!brands ? (
          <div className="grid place-items-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          shown.map((b) => {
            const on = selected.includes(b.id)
            return (
              <button
                key={b.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(b.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted"
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded border',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300',
                  )}
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
