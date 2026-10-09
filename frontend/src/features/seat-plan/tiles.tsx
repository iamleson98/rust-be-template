import type { ButtonHTMLAttributes, CSSProperties } from 'react'
import { Check, DoorOpen, Toilet } from 'lucide-react'
import { Stairs, SteeringWheel } from '@/components/icons/icons'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { TileSize } from './deck-grid'
import { isBerth, type CellKind } from './model'

export const KIND_LABELS: Record<CellKind, string> = {
  seat: 'seatPlan.kind.seat',
  bed: 'seatPlan.kind.bed',
  cabin: 'seatPlan.kind.cabin',
  cabin_double: 'seatPlan.kind.cabinDouble',
  driver: 'seatPlan.kind.driver',
  door: 'seatPlan.kind.door',
  stairs: 'seatPlan.kind.stairs',
  wc: 'seatPlan.kind.wc',
}

const ICON: Record<TileSize, string> = { md: 'h-4 w-4', sm: 'h-3.5 w-3.5', xs: 'hidden' }

/** Driver, door, stairs and toilet — drawn, never sold. */
export function FixtureTile({ kind, size = 'md' }: { kind: CellKind; size?: TileSize }) {
  const t = useT()
  const label = t(KIND_LABELS[kind])
  const icon = ICON[size]
  if (kind === 'driver') {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="flex h-[82%] w-[82%] items-center justify-center rounded-full bg-slate-800 text-white"
      >
        <SteeringWheel className={icon} />
      </span>
    )
  }
  const Icon = kind === 'door' ? DoorOpen : kind === 'stairs' ? Stairs : Toilet
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed text-slate-400',
        kind === 'wc' ? 'border-sky-200 bg-sky-50 text-sky-500' : 'border-slate-300',
        size === 'xs' && 'border',
      )}
    >
      <Icon className={icon} />
    </span>
  )
}

export type TileState = 'idle' | 'available' | 'selected' | 'locked' | 'taken'

const STATE: Record<TileState, string> = {
  idle: 'border-slate-300 bg-white text-slate-700',
  available: 'border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-primary/50',
  selected: 'scale-105 border-primary bg-primary text-primary-foreground',
  locked: 'cursor-not-allowed border-warning/40 bg-warning/20 text-warning-foreground',
  taken: 'cursor-not-allowed border-slate-300 bg-slate-200 text-slate-400 line-through',
}

type TileProps = {
  kind: CellKind
  label: string
  state?: TileState
  size?: TileSize
  /** Class colour: tints the border and adds a corner dot on available seats. */
  accent?: string
  /** Corner price tag ("+50k"). */
  tag?: string
  /** Editor highlight. */
  ring?: boolean
  /** Render a plain `<span>` (thumbnails) instead of a button. */
  as?: 'button' | 'span'
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

/** A sellable cell: seat, bed, cabin or double cabin. */
export function SeatTile({
  kind,
  label,
  state = 'idle',
  size = 'md',
  accent,
  tag,
  ring,
  as = 'button',
  className,
  style,
  ...rest
}: TileProps) {
  const berth = isBerth(kind)
  const bare = size === 'xs'
  const tint: CSSProperties | undefined =
    accent && state === 'available' ? { borderColor: `${accent}40` } : undefined
  const cls = cn(
    'relative flex h-full w-full items-center justify-center border-2 font-bold transition-all',
    berth ? 'rounded-md' : 'rounded-lg',
    size === 'md' ? 'text-[10px]' : 'text-[9px]',
    bare && 'border text-[0px]',
    berth && !bare && 'flex-col justify-end pb-1',
    STATE[state],
    ring && 'ring-2 ring-blue-500 ring-offset-1',
    className,
  )
  const face = (
    <>
      {berth && !bare && <Pillows double={kind === 'cabin_double'} />}
      {state === 'selected' && !bare ? (
        <Check className={size === 'md' ? 'h-4 w-4' : 'h-3 w-3'} />
      ) : (
        <span className="relative">{label}</span>
      )}
      {state === 'available' && accent && !bare && (
        <span
          className="absolute -top-1 -right-1 h-2 w-2 rounded-full ring-1 ring-white"
          style={{ background: accent }}
        />
      )}
      {tag && state !== 'selected' && (
        <span
          className="absolute -top-2 -left-2 rounded-full bg-amber-500 px-1 py-px text-[10px] leading-none font-bold text-white ring-1 ring-white"
          aria-hidden
        >
          {tag}
        </span>
      )}
    </>
  )
  const merged = { ...tint, ...style }
  return as === 'span' ? (
    <span className={cls} style={merged}>
      {face}
    </span>
  ) : (
    <button type="button" className={cls} style={merged} {...rest}>
      {face}
    </button>
  )
}

/** The pillow end of a berth; a double cabin shows two. */
function Pillows({ double }: { double: boolean }) {
  return (
    <span
      className="pointer-events-none absolute inset-x-1.5 top-1 flex justify-center gap-1"
      aria-hidden
    >
      <span className="h-1.5 w-full max-w-5 rounded-full bg-current opacity-20" />
      {double && <span className="h-1.5 w-full max-w-5 rounded-full bg-current opacity-20" />}
    </span>
  )
}
