'use client'

import { useMemo } from 'react'
import { Baby, Info } from 'lucide-react'
import type { ChildFarePolicy, TripSeat, TripSeatDeck } from '@/api'
import { cn } from '@/lib/utils'
import { SEAT_CLASS_COLORS, SEAT_CLASS_LABELS } from '@/lib/labels'
import { formatVND, formatVndShort } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { DeckFrame, DeckGrid, type GridItem } from './deck-grid'
import { isBerth, toDeckViews, type CellKind, type DeckView } from './model'
import { FixtureTile, SeatTile, type TileState } from './tiles'

type Props = {
  decks: readonly TripSeatDeck[]
  selectedSeatIds: readonly string[]
  onToggleSeat: (seat: TripSeat) => void
  /** Seats that may be selected at once; omit for no limit. */
  maxSeats?: number
  /** The brand's child tickets, noted in the legend. */
  childFare?: ChildFarePolicy | null
  /** Counter sale in the admin console: small tiles, no instruction banner. */
  compact?: boolean
}

/** One seat class on this trip and its cheapest seat (for sale, if any is). */
type Tier = { cls: string; price: number }

function fareTiers(views: DeckView[]): Tier[] {
  const tiers = new Map<string, { price: number; available: boolean }>()
  for (const { seat } of views.flatMap((v) => v.seats)) {
    const cls = seat.seatClass ?? 'standard'
    const available = seat.status === 'available'
    const tier = tiers.get(cls)
    if (
      !tier ||
      (available && !tier.available) ||
      (available === tier.available && seat.finalPrice < tier.price)
    ) {
      tiers.set(cls, { price: seat.finalPrice, available })
    }
  }
  return [...tiers].map(([cls, { price }]) => ({ cls, price })).sort((a, b) => a.price - b.price)
}

/** "+50k": surcharge over the cheapest available seat, rounded to 0.5k. */
function formatPriceDiff(diff: number): string {
  if (diff < 1000) return `+${diff}`
  const k = Math.round((diff / 1000) * 2) / 2
  return `+${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`
}

const kindOf = (seat: TripSeat): CellKind =>
  seat.kind ?? (seat.seatClass?.startsWith('bed_') ? 'bed' : 'seat')

/** Seat selection over the vehicle's real floor plan. */
export function SeatMap({
  decks,
  selectedSeatIds,
  onToggleSeat,
  maxSeats,
  childFare,
  compact = false,
}: Props) {
  const t = useT()
  const views = useMemo(() => toDeckViews(decks), [decks])
  const tiers = useMemo(() => fareTiers(views), [views])
  const selected = useMemo(() => new Set(selectedSeatIds), [selectedSeatIds])
  const cheapest = useMemo(() => {
    const prices = views.flatMap((v) =>
      v.seats.filter((p) => p.seat.status === 'available').map((p) => p.seat.finalPrice),
    )
    return prices.length ? Math.min(...prices) : null
  }, [views])
  const full = maxSeats !== undefined && selected.size >= maxSeats

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      {!compact && !!maxSeats && (
        <div className="flex items-start gap-2 rounded-lg border border-info/20 bg-info/5 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <div>
            <span className="font-semibold text-info">{t('trips.seatGuideTitle')}</span>{' '}
            {t('trips.seatGuideBody', { count: maxSeats })}
          </div>
        </div>
      )}

      {views.map((view) => (
        <DeckFrame
          key={view.deck}
          title={views.length > 1 ? (view.name ?? deckTitle(t, view.deck)) : undefined}
          aside={views.length > 1 ? t('trips.deckLabel', { deck: view.deck }) : undefined}
        >
          <DeckSeats
            view={view}
            size={compact ? 'sm' : 'md'}
            selected={selected}
            full={full}
            cheapest={cheapest}
            onToggle={onToggleSeat}
          />
        </DeckFrame>
      ))}

      <Legend tiers={tiers} childFare={childFare} />
    </div>
  )
}

const deckTitle = (t: ReturnType<typeof useT>, deck: number) =>
  deck === 1 ? t('trips.deckLower') : t('trips.deckUpper')

function DeckSeats({
  view,
  size,
  selected,
  full,
  cheapest,
  onToggle,
}: {
  view: DeckView
  size: 'md' | 'sm'
  selected: Set<string>
  full: boolean
  cheapest: number | null
  onToggle: (seat: TripSeat) => void
}) {
  const t = useT()
  const items: GridItem[] = [
    ...view.fixtures.map((f) => ({
      key: `fixture-${f.row}-${f.col}`,
      row: f.row,
      col: f.col,
      node: <FixtureTile kind={f.kind} size={size} />,
    })),
    ...view.seats.map(({ seat, row, col }) => {
      const kind = kindOf(seat)
      const isSelected = selected.has(seat.id)
      const available = seat.status === 'available'
      const state: TileState = isSelected
        ? 'selected'
        : available
          ? 'available'
          : seat.status === 'locked'
            ? 'locked'
            : 'taken'
      const cls = seat.seatClass ?? 'standard'
      const classLabel = t(SEAT_CLASS_LABELS[cls] ?? 'types.seatStandard')
      const surcharge = available && cheapest !== null ? seat.finalPrice - cheapest : 0
      return {
        key: seat.id,
        row,
        col,
        tall: isBerth(kind),
        node: (
          <SeatTile
            kind={kind}
            label={seat.code}
            state={state}
            size={size}
            accent={SEAT_CLASS_COLORS[cls] ?? '#64748b'}
            tag={surcharge > 0 ? formatPriceDiff(surcharge) : undefined}
            caption={formatVndShort(seat.finalPrice)}
            disabled={!available || (full && !isSelected)}
            onClick={() => onToggle(seat)}
            title={`${seat.code} • ${classLabel} • ${formatVND(seat.finalPrice)}`}
            aria-label={t('trips.seatAriaLabel', {
              code: seat.code,
              seatClass: classLabel,
              price: formatVND(seat.finalPrice),
              status: isSelected
                ? t('trips.seatStatusSelected')
                : available
                  ? t('trips.seatStatusAvailable')
                  : t('trips.seatStatusOccupied'),
            })}
            aria-pressed={isSelected}
          />
        ),
      }
    }),
  ]
  return (
    <DeckGrid
      rows={view.rows}
      cols={view.cols}
      size={size}
      berths={view.berths}
      items={items}
      role="group"
      aria-label={view.name ?? deckTitle(t, view.deck)}
    />
  )
}

function Legend({ tiers, childFare }: { tiers: Tier[]; childFare?: ChildFarePolicy | null }) {
  const t = useT()
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <LegendItem
          className="border-2 border-slate-300 bg-white"
          label={t('trips.legendAvailable')}
        />
        <LegendItem
          className="bg-primary text-primary-foreground"
          label={t('trips.legendSelected')}
        />
        <LegendItem className="bg-slate-300 text-slate-500" label={t('trips.legendBooked')} />
        <LegendItem
          className="border border-warning/50 bg-warning/30"
          label={t('trips.legendHeld')}
        />
      </div>
      {tiers.length > 0 && (
        <ul
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
          aria-label={t('trips.fareTiers')}
        >
          {tiers.map(({ cls, price }) => (
            <li key={cls} className="flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-sm"
                style={{ background: SEAT_CLASS_COLORS[cls] ?? '#64748b' }}
              />
              <span className="text-muted-foreground">{t(SEAT_CLASS_LABELS[cls] ?? cls)}</span>
              <span className="font-semibold text-slate-800 tabular-nums">{formatVND(price)}</span>
            </li>
          ))}
        </ul>
      )}
      {childFare && (
        <p className="flex items-center gap-1.5 text-amber-700">
          <Baby className="h-3.5 w-3.5 shrink-0" />
          {childFare.discountPercent > 0
            ? t('trips.childFareDiscount', {
                age: childFare.maxAge,
                percent: childFare.discountPercent,
              })
            : t('trips.childFarePrice', { age: childFare.maxAge })}
        </p>
      )}
    </div>
  )
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('h-4 w-4 rounded', className)} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}
