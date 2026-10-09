'use client'

import type { KeyboardEvent } from 'react'
import { FlipHorizontal2, ListOrdered, Minus, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { DeckFrame, DeckGrid, type GridItem } from '../deck-grid'
import { LIMITS, isBerth, isSellable } from '../model'
import { FixtureTile, SeatTile } from '../tiles'
import type { PlanEditorApi } from './use-plan-editor'

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

/** Deck tabs, per-deck controls and the clickable grid. */
export function Canvas({ editor }: { editor: PlanEditorApi }) {
  const t = useT()
  const { state, dispatch, deck, selectedCell } = editor
  const multi = state.plan.decks.length > 1

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return
    const arrow = ARROWS[e.key]
    if (arrow && selectedCell) {
      e.preventDefault()
      dispatch({ type: 'nudge', dRow: arrow[0], dCol: arrow[1] })
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCell) {
      dispatch({ type: 'remove' })
    } else if (e.key === 'Escape') {
      dispatch({ type: 'select', pos: null })
    }
  }

  const items: GridItem[] = deck.cells.map((cell) => {
    const pos = { row: cell.row, col: cell.col }
    const selected = state.selected?.row === cell.row && state.selected?.col === cell.col
    const click = () => dispatch({ type: 'click', pos })
    return {
      key: `${cell.row}:${cell.col}`,
      row: cell.row,
      col: cell.col,
      tall: isBerth(cell.kind),
      node: isSellable(cell.kind) ? (
        <SeatTile
          kind={cell.kind}
          label={cell.label ?? '?'}
          ring={selected}
          onClick={click}
          aria-label={`${cell.label ?? ''} (${cell.row}, ${cell.col})`}
        />
      ) : (
        <button
          type="button"
          onClick={click}
          className={cn(
            'h-full w-full rounded-lg',
            selected && 'ring-2 ring-blue-500 ring-offset-1',
          )}
        >
          <FixtureTile kind={cell.kind} />
        </button>
      ),
    }
  })

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {state.plan.decks.map((d, i) => (
          <button
            key={i}
            type="button"
            onClick={() => dispatch({ type: 'deck', index: i })}
            aria-pressed={state.deck === i}
            className={cn(
              'h-8 rounded-md border px-3 text-xs font-semibold transition-colors',
              state.deck === i
                ? 'border-blue-400 bg-blue-50 text-blue-700'
                : 'border-input text-muted-foreground hover:border-blue-300',
            )}
          >
            {d.name || t('seatPlan.deck', { n: i + 1 })}
          </button>
        ))}
        {!multi && !state.locked && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'addDeck' })}
          >
            <Plus className="h-3.5 w-3.5" /> {t('seatPlan.addDeck')}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={t('seatPlan.undo')}
            disabled={!state.past.length}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label={t('seatPlan.redo')}
            disabled={!state.future.length}
            onClick={() => dispatch({ type: 'redo' })}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label={t('seatPlan.mirror')} onClick={() => dispatch({ type: 'mirror' })}>
            <FlipHorizontal2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label={t('seatPlan.renumber')}
            disabled={state.locked}
            onClick={() => dispatch({ type: 'renumber' })}
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </IconButton>
          {multi && (
            <IconButton
              label={t('seatPlan.removeDeck')}
              disabled={state.locked}
              onClick={() => dispatch({ type: 'removeDeck' })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Stepper
          label={t('seatPlan.rows')}
          value={deck.rows}
          max={LIMITS.rows}
          onChange={(rows) => dispatch({ type: 'resize', rows, cols: deck.cols })}
        />
        <Stepper
          label={t('seatPlan.cols')}
          value={deck.cols}
          max={LIMITS.cols}
          onChange={(cols) => dispatch({ type: 'resize', rows: deck.rows, cols })}
        />
        {multi && (
          <div className="grid gap-1">
            <Label htmlFor="deck-name" className="text-[10px] text-muted-foreground uppercase">
              {t('seatPlan.deckName')}
            </Label>
            <Input
              id="deck-name"
              className="h-8 w-40"
              value={deck.name ?? ''}
              maxLength={40}
              placeholder={t('seatPlan.deck', { n: state.deck + 1 })}
              onChange={(e) => dispatch({ type: 'deckName', name: e.target.value })}
            />
          </div>
        )}
      </div>

      <DeckFrame>
        {/* Arrow keys / Delete / Escape act on the selected cell. */}
        <div onKeyDown={onKeyDown}>
          <DeckGrid
            rows={deck.rows}
            cols={deck.cols}
            berths={deck.cells.some((c) => isBerth(c.kind))}
            items={items}
            renderEmpty={(row, col) => (
              <button
                type="button"
                onClick={() => dispatch({ type: 'click', pos: { row, col } })}
                aria-label={t('seatPlan.emptyCell', { row, col })}
                className="h-full w-full rounded-md border border-dashed border-slate-200 transition-colors hover:border-blue-300 hover:bg-blue-50"
              />
            )}
          />
        </div>
      </DeckFrame>
      <p className="text-xs text-muted-foreground">
        {state.tool === 'select'
          ? t('seatPlan.hint.select')
          : state.tool === 'erase'
            ? t('seatPlan.hint.erase')
            : t('seatPlan.hint.paint')}
      </p>
    </div>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function Stepper({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: number
  max: number
  onChange: (n: number) => void
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[10px] text-muted-foreground uppercase">{label}</Label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={`${label} −`}
          disabled={value <= 1}
          onClick={() => onChange(value - 1)}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-7 text-center text-sm font-semibold tabular-nums">{value}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={`${label} +`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
