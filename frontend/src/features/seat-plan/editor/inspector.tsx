'use client'

import { AlertTriangle, Lock, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ComboboxField } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SEAT_CLASS_LABELS } from '@/lib/labels'
import { useT } from '@/lib/i18n'
import { LIMITS, SELLABLE_KINDS, FIXTURE_KINDS, isSellable, sellableCount } from '../model'
import { KIND_LABELS } from '../tiles'
import type { PlanEditorApi } from './use-plan-editor'

/** Selected-cell form, plan summary, and what blocks saving. */
export function Inspector({ editor }: { editor: PlanEditorApi }) {
  const t = useT()
  const { state, dispatch, selectedCell: cell, issues } = editor
  const kinds = [...SELLABLE_KINDS, ...FIXTURE_KINDS].map((k) => ({
    value: k,
    label: t(KIND_LABELS[k]),
  }))
  const classes = [
    { value: '', label: t('seatPlan.classAuto') },
    ...Object.entries(SEAT_CLASS_LABELS).map(([value, key]) => ({ value, label: t(key) })),
  ]

  return (
    <div className="space-y-4 text-sm">
      {state.locked && (
        <Notice icon={<Lock className="h-4 w-4" />} tone="amber">
          {t('seatPlan.locked')}
        </Notice>
      )}

      <section className="space-y-3 rounded-lg border p-3">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('seatPlan.inspector.title')}
        </h3>
        {cell ? (
          <>
            <div className="grid gap-1.5">
              <Label>{t('seatPlan.field.kind')}</Label>
              <ComboboxField
                value={cell.kind}
                onValueChange={(kind) =>
                  dispatch({ type: 'patch', patch: { kind: kind as typeof cell.kind } })
                }
                items={kinds}
                aria-label={t('seatPlan.field.kind')}
              />
            </div>
            {isSellable(cell.kind) && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="cell-label">{t('seatPlan.field.label')}</Label>
                  <Input
                    id="cell-label"
                    value={cell.label ?? ''}
                    maxLength={LIMITS.labelChars}
                    onChange={(e) => dispatch({ type: 'patch', patch: { label: e.target.value } })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t('seatPlan.field.class')}</Label>
                  <ComboboxField
                    value={cell.seatClass ?? ''}
                    onValueChange={(seatClass) =>
                      dispatch({ type: 'patch', patch: { seatClass: seatClass || null } })
                    }
                    items={classes}
                    aria-label={t('seatPlan.field.class')}
                  />
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t('seatPlan.position', { row: cell.row, col: cell.col })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={state.locked && isSellable(cell.kind)}
                onClick={() => dispatch({ type: 'remove' })}
              >
                <Trash2 className="h-3.5 w-3.5" /> {t('seatPlan.remove')}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t('seatPlan.inspector.empty')}</p>
        )}
      </section>

      <section className="rounded-lg border p-3">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">{t('seatPlan.total')}</span>
          <span className="text-lg font-bold tabular-nums">{sellableCount(state.plan)}</span>
        </div>
        {state.plan.decks.length > 1 && (
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {state.plan.decks.map((d, i) => (
              <li key={i} className="flex justify-between">
                <span>{d.name || t('seatPlan.deck', { n: i + 1 })}</span>
                <span className="tabular-nums">
                  {d.cells.filter((c) => isSellable(c.kind)).length}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {issues.length > 0 && (
        <Notice icon={<AlertTriangle className="h-4 w-4" />} tone="red">
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.slice(0, 5).map((issue, i) => (
              <li key={i}>{t(`seatPlan.issue.${issue.code}`, issue.params)}</li>
            ))}
            {issues.length > 5 && <li>{t('seatPlan.issue.more', { count: issues.length - 5 })}</li>}
          </ul>
        </Notice>
      )}
    </div>
  )
}

function Notice({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode
  tone: 'amber' | 'red'
  children: React.ReactNode
}) {
  return (
    <div
      role={tone === 'red' ? 'alert' : 'note'}
      className={
        tone === 'red'
          ? 'flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800'
          : 'flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900'
      }
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>{children}</div>
    </div>
  )
}
