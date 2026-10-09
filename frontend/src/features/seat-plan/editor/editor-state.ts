import {
  cellAt,
  cloneDeckAbove,
  dropCell,
  isSellable,
  mirrorDeck,
  moveCell,
  nextLabel,
  putCell,
  renumber,
  resizeDeck,
  type CellKind,
  type DeckPlan,
  type PlanCell,
  type Pos,
  type SeatPlan,
} from '../model'

export type Tool = 'select' | 'erase' | CellKind

export type EditorState = {
  plan: SeatPlan
  /** Index of the deck being edited. */
  deck: number
  tool: Tool
  selected: Pos | null
  /** Trips already sell these seats: cells may move or change, never appear or vanish. */
  locked: boolean
  past: SeatPlan[]
  future: SeatPlan[]
}

export type EditorAction =
  | { type: 'tool'; tool: Tool }
  | { type: 'deck'; index: number }
  | { type: 'click'; pos: Pos }
  | { type: 'patch'; patch: Partial<Pick<PlanCell, 'label' | 'seatClass' | 'kind'>> }
  | { type: 'remove' }
  | { type: 'nudge'; dRow: number; dCol: number }
  | { type: 'select'; pos: Pos | null }
  | { type: 'resize'; rows: number; cols: number }
  | { type: 'deckName'; name: string }
  | { type: 'addDeck' }
  | { type: 'removeDeck' }
  | { type: 'mirror' }
  | { type: 'renumber' }
  | { type: 'replace'; plan: SeatPlan }
  | { type: 'undo' }
  | { type: 'redo' }

const HISTORY = 50

export const initEditor = (plan: SeatPlan, locked: boolean): EditorState => ({
  plan,
  deck: 0,
  tool: 'select',
  selected: null,
  locked,
  past: [],
  future: [],
})

/** A locked plan keeps its seat set: a sellable cell may only become another sellable cell. */
const keepsSeatSet = (existing: PlanCell | undefined, kind: CellKind | null) =>
  isSellable(existing?.kind ?? 'door') === isSellable(kind ?? 'door')

const sellableOf = (deck: DeckPlan) => deck.cells.filter((c) => isSellable(c.kind)).length

/** Commit `plan` as a new history entry. */
function commit(s: EditorState, plan: SeatPlan, patch: Partial<EditorState> = {}): EditorState {
  if (plan === s.plan) return { ...s, ...patch }
  return { ...s, ...patch, plan, past: [...s.past, s.plan].slice(-HISTORY), future: [] }
}

const withDeck = (s: EditorState, deck: DeckPlan): SeatPlan => ({
  decks: s.plan.decks.map((d, i) => (i === s.deck ? deck : d)),
})

const activeDeck = (s: EditorState) => s.plan.decks[s.deck]

function place(s: EditorState, pos: Pos, kind: CellKind): EditorState {
  const deck = activeDeck(s)
  const existing = cellAt(deck, pos)
  if (s.locked && !keepsSeatSet(existing, kind)) return s
  if (existing?.kind === kind) return { ...s, selected: pos }

  let base = deck
  if (kind === 'driver') {
    // one steering wheel per deck: painting a new one moves it
    base = {
      ...deck,
      cells: deck.cells.filter((c) => c.kind !== 'driver' || (c.row === pos.row && c.col === pos.col)),
    }
  }
  const sellable = isSellable(kind)
  const cell: PlanCell = {
    ...pos,
    kind,
    ...(sellable
      ? {
          label: existing?.label ?? nextLabel(withDeck(s, base), s.deck),
          seatClass: existing?.seatClass ?? null,
          seatId: existing?.seatId ?? null,
        }
      : {}),
  }
  return commit(s, withDeck(s, putCell(base, cell)), { selected: pos })
}

function erase(s: EditorState, pos: Pos): EditorState {
  const existing = cellAt(activeDeck(s), pos)
  if (!existing || (s.locked && !keepsSeatSet(existing, null))) return s
  return commit(s, withDeck(s, dropCell(activeDeck(s), pos)), { selected: null })
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  const deck = activeDeck(s)
  switch (a.type) {
    case 'tool':
      return { ...s, tool: a.tool }
    case 'deck':
      return a.index === s.deck ? s : { ...s, deck: a.index, selected: null }
    case 'select':
      return { ...s, selected: a.pos }
    case 'click': {
      if (s.tool === 'erase') return erase(s, a.pos)
      if (s.tool !== 'select') return place(s, a.pos, s.tool)
      if (cellAt(deck, a.pos)) return { ...s, selected: a.pos }
      if (!s.selected) return s
      return commit(s, withDeck(s, moveCell(deck, s.selected, a.pos)), { selected: a.pos })
    }
    case 'nudge': {
      if (!s.selected) return s
      const to = { row: s.selected.row + a.dRow, col: s.selected.col + a.dCol }
      if (to.row < 1 || to.row > deck.rows || to.col < 1 || to.col > deck.cols) return s
      return commit(s, withDeck(s, moveCell(deck, s.selected, to)), { selected: to })
    }
    case 'patch': {
      const cell = s.selected && cellAt(deck, s.selected)
      if (!cell || !s.selected) return s
      if (a.patch.kind && s.locked && !keepsSeatSet(cell, a.patch.kind)) return s
      const next = { ...cell, ...a.patch }
      if (a.patch.kind && !isSellable(a.patch.kind)) {
        delete next.label
        delete next.seatClass
        delete next.seatId
      } else if (a.patch.kind && !next.label) {
        next.label = nextLabel(withDeck(s, deck), s.deck)
      }
      return commit(s, withDeck(s, putCell(deck, next)))
    }
    case 'remove':
      return s.selected ? erase(s, s.selected) : s
    case 'resize': {
      const next = resizeDeck(deck, a.rows, a.cols)
      if (s.locked && sellableOf(next) !== sellableOf(deck)) return s
      const sel = s.selected
      return commit(s, withDeck(s, next), {
        selected: sel && sel.row <= next.rows && sel.col <= next.cols ? sel : null,
      })
    }
    case 'deckName':
      return commit(s, withDeck(s, { ...deck, name: a.name || null }))
    case 'addDeck': {
      if (s.locked) return s
      const plan = cloneDeckAbove(s.plan)
      return plan === s.plan ? s : commit(s, plan, { deck: plan.decks.length - 1, selected: null })
    }
    case 'removeDeck': {
      if (s.locked || s.plan.decks.length < 2) return s
      const decks = s.plan.decks.filter((_, i) => i !== s.deck)
      return commit(s, { decks }, { deck: Math.min(s.deck, decks.length - 1), selected: null })
    }
    case 'mirror':
      return commit(s, withDeck(s, mirrorDeck(deck)), { selected: null })
    case 'renumber':
      return s.locked ? s : commit(s, renumber(s.plan))
    case 'replace':
      return commit(s, a.plan, { deck: 0, selected: null })
    case 'undo': {
      const prev = s.past.at(-1)
      if (!prev) return s
      return {
        ...s,
        plan: prev,
        past: s.past.slice(0, -1),
        future: [s.plan, ...s.future],
        deck: Math.min(s.deck, prev.decks.length - 1),
        selected: null,
      }
    }
    case 'redo': {
      const [next, ...rest] = s.future
      if (!next) return s
      return {
        ...s,
        plan: next,
        past: [...s.past, s.plan],
        future: rest,
        deck: Math.min(s.deck, next.decks.length - 1),
        selected: null,
      }
    }
  }
}
