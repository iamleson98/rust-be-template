'use client'

import { useWatch } from 'react-hook-form'
import { Baby, Info } from 'lucide-react'
import type { AdminBusLayoutOut, ChildFarePolicy } from '@/api'
import { Input } from '@/components/ui/input'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { formatVND } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { SEAT_CLASS_COLORS, SEAT_CLASS_LABELS } from '@/lib/labels'
import type { ScheduleFormInstance } from './schedule-schema'

type Row = { cls: string; seats: number | null }

/** The brand's child price for an adult fare, as the server rounds it. */
const discounted = (adult: number, policy: ChildFarePolicy) =>
  Math.round((adult * (100 - policy.discountPercent)) / 100 / 1000) * 1000

/**
 * What every seat class costs on this schedule. Standard seats use the base price,
 * which any other class falls back to; children pay the brand's discount unless a
 * class sets its own child price.
 */
export function ScheduleFares({
  form,
  layout,
  childFare,
}: {
  form: ScheduleFormInstance
  layout: AdminBusLayoutOut | undefined
  childFare: ChildFarePolicy | null
}) {
  const t = useT()
  const base = Number(useWatch({ control: form.control, name: 'basePriceAdult' })) || 0
  const classFares = useWatch({ control: form.control, name: 'classFares' }) ?? {}

  const onLayout = new Map((layout?.seatClasses ?? []).map((c) => [c.seatClass, c.seats]))
  const rows: Row[] = [
    { cls: 'standard', seats: layout ? (onLayout.get('standard') ?? 0) : null },
    ...[...new Set([...onLayout.keys(), ...Object.keys(classFares)])]
      .filter((cls) => cls !== 'standard')
      .map((cls) => ({ cls, seats: layout ? (onLayout.get(cls) ?? 0) : null })),
  ]

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">{t('adminSchedules.faresTitle')}</h4>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Baby className="h-3.5 w-3.5" />
          {childFare
            ? t('adminSchedules.childFarePolicy', {
                age: childFare.maxAge,
                percent: childFare.discountPercent,
              })
            : t('adminSchedules.noChildFare')}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t('adminSchedules.seatClass')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('adminSchedules.priceAdult')}</th>
              {childFare && (
                <th className="px-3 py-2 text-left font-medium">
                  {t('adminSchedules.priceChild')}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ cls, seats }) => {
              const standard = cls === 'standard'
              const adult = standard ? base : Number(classFares[cls]?.priceAdult) || base
              return (
                <tr key={cls} className="align-top">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 pt-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm"
                        style={{ background: SEAT_CLASS_COLORS[cls] ?? '#64748b' }}
                      />
                      <span className="font-medium">{t(SEAT_CLASS_LABELS[cls] ?? cls)}</span>
                      {seats !== null && (
                        <span className="text-xs text-muted-foreground">
                          {seats > 0
                            ? t('busLayouts.seatsCount', { count: seats })
                            : t('adminSchedules.notOnLayout')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <PriceField
                      form={form}
                      name={standard ? 'basePriceAdult' : `classFares.${cls}.priceAdult`}
                      placeholder={standard ? '350000' : formatVND(base)}
                      label={t('adminSchedules.priceAdultFor', {
                        cls: t(SEAT_CLASS_LABELS[cls] ?? cls),
                      })}
                    />
                  </td>
                  {childFare && (
                    <td className="px-3 py-2">
                      <PriceField
                        form={form}
                        name={standard ? 'basePriceChild' : `classFares.${cls}.priceChild`}
                        placeholder={formatVND(discounted(adult, childFare))}
                        label={t('adminSchedules.priceChildFor', {
                          cls: t(SEAT_CLASS_LABELS[cls] ?? cls),
                        })}
                      />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
        {t('adminSchedules.faresHint')}
      </p>
    </section>
  )
}

function PriceField({
  form,
  name,
  placeholder,
  label,
}: {
  form: ScheduleFormInstance
  name: 'basePriceAdult' | 'basePriceChild' | `classFares.${string}.${'priceAdult' | 'priceChild'}`
  placeholder: string
  label: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="space-y-1">
          <FormControl>
            <Input
              type="number"
              min="0"
              step="1000"
              inputMode="numeric"
              value={!field.value ? '' : String(field.value)}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              placeholder={placeholder}
              aria-label={label}
              className="min-w-28"
            />
          </FormControl>
          <FormMessage className="text-[11px]" />
        </FormItem>
      )}
    />
  )
}
