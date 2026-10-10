'use client'

import type { ReactNode } from 'react'
import { Flag, MapPin } from 'lucide-react'
import type { TripPickupPoint } from '@/api'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type Props = {
  points: TripPickupPoint[]
  boardingPoint: string
  droppingPoint: string
  onBoardingPoint: (id: string) => void
  onDroppingPoint: (id: string) => void
}

/**
 * Where to get on and off, for routes with pickup points. Nobody boards at the last
 * stop or gets off at the first, so each list leaves that one out.
 */
export function BoardingPoints({
  points,
  boardingPoint,
  droppingPoint,
  onBoardingPoint,
  onDroppingPoint,
}: Props) {
  const t = useT()
  if (points.length === 0) return null
  const ordered = [...points].sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
  return (
    <div className="space-y-5">
      <PointList
        title={t('tripDetail.pickupLabel')}
        icon={<MapPin className="h-3.5 w-3.5 text-blue-700" />}
        tone="blue"
        points={ordered.length > 1 ? ordered.slice(0, -1) : ordered}
        selected={boardingPoint}
        onSelect={onBoardingPoint}
      />
      <PointList
        title={t('tripDetail.dropoffLabel')}
        icon={<Flag className="h-3.5 w-3.5 text-rose-600" />}
        tone="rose"
        points={ordered.length > 1 ? ordered.slice(1) : ordered}
        selected={droppingPoint}
        onSelect={onDroppingPoint}
      />
    </div>
  )
}

const TONES = {
  blue: {
    title: 'text-blue-800',
    on: 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20',
    hover: 'hover:border-blue-300 hover:bg-blue-50/40',
    dot: 'bg-blue-600',
  },
  rose: {
    title: 'text-rose-700',
    on: 'border-rose-400 bg-rose-50 ring-2 ring-rose-400/20',
    hover: 'hover:border-rose-300 hover:bg-rose-50/40',
    dot: 'bg-rose-500',
  },
}

function PointList({
  title,
  icon,
  tone,
  points,
  selected,
  onSelect,
}: {
  title: string
  icon: ReactNode
  tone: keyof typeof TONES
  points: TripPickupPoint[]
  selected: string
  onSelect: (id: string) => void
}) {
  const style = TONES[tone]
  return (
    <fieldset>
      <legend
        className={cn(
          'mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide',
          style.title,
        )}
      >
        {icon}
        {title}
      </legend>
      <div className="space-y-2">
        {points.map((p) => {
          const on = selected === p.id
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(p.id)}
              className={cn(
                'w-full rounded-xl border px-3.5 py-2.5 text-left text-sm transition-all',
                on ? style.on : cn('border-slate-200 bg-white', style.hover),
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', on ? style.dot : 'bg-slate-300')}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{p.name ?? '—'}</span>
                  {p.address && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {p.address}
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
