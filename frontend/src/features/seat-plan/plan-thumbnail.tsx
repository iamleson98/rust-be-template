import { cn } from '@/lib/utils'
import { DeckGrid, type GridItem, type TileSize } from './deck-grid'
import { isBerth, isSellable, type DeckPlan, type SeatPlan } from './model'
import { FixtureTile, SeatTile } from './tiles'

const deckItems = (deck: DeckPlan, size: TileSize): GridItem[] =>
  deck.cells.map((c) => ({
    key: `${c.row}:${c.col}`,
    row: c.row,
    col: c.col,
    tall: isBerth(c.kind),
    node: isSellable(c.kind) ? (
      <SeatTile as="span" kind={c.kind} label={c.label ?? ''} size={size} className="bg-slate-100" />
    ) : (
      <FixtureTile kind={c.kind} size={size} />
    ),
  }))

/** Read-only miniature of a plan: every deck side by side. */
export function PlanThumbnail({
  plan,
  size = 'xs',
  className,
}: {
  plan: SeatPlan
  size?: TileSize
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-center gap-2', className)} aria-hidden>
      {plan.decks.map((deck, i) => (
        <div key={i} className="rounded-md border border-slate-200 bg-white p-1.5">
          <DeckGrid
            rows={deck.rows}
            cols={deck.cols}
            size={size}
            berths={deck.cells.some((c) => isBerth(c.kind))}
            items={deckItems(deck, size)}
          />
        </div>
      ))}
    </div>
  )
}
