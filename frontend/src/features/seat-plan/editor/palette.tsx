'use client'

import type { ComponentType } from 'react'
import {
  Armchair,
  Bed,
  BedDouble,
  BedSingle,
  DoorOpen,
  Eraser,
  MousePointer2,
  Toilet,
} from 'lucide-react'
import { Stairs, SteeringWheel } from '@/components/icons/icons'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { KIND_LABELS } from '../tiles'
import type { Tool } from './editor-state'

type Entry = { tool: Tool; label: string; Icon: ComponentType<{ className?: string }> }

const GROUPS: { title: string; tools: Entry[] }[] = [
  {
    title: 'seatPlan.palette.edit',
    tools: [
      { tool: 'select', label: 'seatPlan.tool.select', Icon: MousePointer2 },
      { tool: 'erase', label: 'seatPlan.tool.erase', Icon: Eraser },
    ],
  },
  {
    title: 'seatPlan.palette.sellable',
    tools: [
      { tool: 'seat', label: KIND_LABELS.seat, Icon: Armchair },
      { tool: 'bed', label: KIND_LABELS.bed, Icon: Bed },
      { tool: 'cabin', label: KIND_LABELS.cabin, Icon: BedSingle },
      { tool: 'cabin_double', label: KIND_LABELS.cabin_double, Icon: BedDouble },
    ],
  },
  {
    title: 'seatPlan.palette.fixtures',
    tools: [
      { tool: 'driver', label: KIND_LABELS.driver, Icon: SteeringWheel },
      { tool: 'door', label: KIND_LABELS.door, Icon: DoorOpen },
      { tool: 'stairs', label: KIND_LABELS.stairs, Icon: Stairs },
      { tool: 'wc', label: KIND_LABELS.wc, Icon: Toilet },
    ],
  },
]

/** Tool picker: what a click on the grid does. */
export function Palette({ tool, onPick }: { tool: Tool; onPick: (tool: Tool) => void }) {
  const t = useT()
  return (
    <div className="flex gap-4 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" role="toolbar">
      {GROUPS.map((g) => (
        <div key={g.title} className="shrink-0">
          <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t(g.title)}
          </div>
          <div className="flex gap-1.5 lg:grid lg:grid-cols-1">
            {g.tools.map(({ tool: id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onPick(id)}
                aria-pressed={tool === id}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
                  tool === id
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-input text-muted-foreground hover:border-blue-300 hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(label)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
