'use client'

import type { ReactNode } from 'react'
import { ArrowDown, Flag, MapPin, Navigation } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { minutesBetween, type Stop } from './trip-stops'

/** The trip's stops top to bottom, with the time at each and the time between them. */
export function StopTimeline({
  title,
  aside,
  stops,
  footer,
}: {
  title: ReactNode
  aside?: ReactNode
  stops: Stop[]
  footer?: ReactNode
}) {
  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-800">
          {title}
        </h3>
        {aside && <span className="text-[10px] text-muted-foreground">{aside}</span>}
      </header>

      <ol>
        {stops.map((stop, i) => {
          const next = stops[i + 1]
          const gap = next ? minutesBetween(stop.time, next.time) : null
          return (
            <li key={stop.id} className="relative flex gap-3">
              <div className="flex w-5 shrink-0 flex-col items-center">
                <Node role={stop.role} />
                {next && (
                  <span
                    className="absolute top-5 bottom-0 border-l-2 border-dashed border-slate-300"
                    aria-hidden
                  />
                )}
              </div>
              <div className={cn('min-w-0 flex-1', next ? 'pb-4' : 'pb-1')}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div
                      className={cn(
                        'truncate text-sm font-semibold',
                        stop.role === 'start' && 'text-blue-800',
                        stop.role === 'end' && 'text-rose-700',
                        stop.role === 'stop' && 'text-slate-700',
                      )}
                    >
                      {stop.name}
                    </div>
                    {stop.address && (
                      <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{stop.address}</span>
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums',
                      !stop.time && 'text-muted-foreground',
                      stop.time && stop.role === 'end' && 'bg-rose-50 font-semibold text-rose-700',
                      stop.time && stop.role !== 'end' && 'bg-blue-50 font-semibold text-blue-700',
                    )}
                  >
                    {stop.time ?? '—'}
                  </span>
                </div>
                {gap && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <ArrowDown className="h-2.5 w-2.5" />
                    {formatDuration(gap)}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {footer}
    </section>
  )
}

function Node({ role }: { role: Stop['role'] }) {
  if (role === 'stop') {
    return (
      <span className="relative z-10 mt-1 h-3 w-3 rounded-full border-2 border-blue-400 bg-blue-50" />
    )
  }
  const Icon = role === 'start' ? Navigation : Flag
  return (
    <span
      className={cn(
        'relative z-10 grid h-5 w-5 place-items-center rounded-full shadow-sm',
        role === 'start' ? 'bg-blue-600' : 'bg-rose-600',
      )}
    >
      <Icon className="h-2.5 w-2.5 text-white" />
    </span>
  )
}
