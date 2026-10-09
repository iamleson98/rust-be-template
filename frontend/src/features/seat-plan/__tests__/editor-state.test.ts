import { describe, expect, it } from 'vitest'
import {
  editorReducer,
  initEditor,
  type EditorAction,
  type EditorState,
} from '../editor/editor-state'
import { cellAt, sellableCount, type PlanCell, type SeatPlan } from '../model'

const seat = (
  row: number,
  col: number,
  label: string,
  extra: Partial<PlanCell> = {},
): PlanCell => ({
  row,
  col,
  kind: 'seat',
  label,
  ...extra,
})

const plan = (cells: PlanCell[], rows = 3, cols = 3): SeatPlan => ({
  decks: [{ rows, cols, cells }],
})

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state)

const base = () =>
  plan([{ row: 1, col: 1, kind: 'driver' }, seat(2, 1, '01', { seatId: 's1' }), seat(2, 3, '02')])

describe('select tool', () => {
  it('selects an occupied cell and moves the selection to an empty one', () => {
    let s = run(initEditor(base(), false), { type: 'click', pos: { row: 2, col: 1 } })
    expect(s.selected).toEqual({ row: 2, col: 1 })

    s = run(s, { type: 'click', pos: { row: 3, col: 2 } })
    expect(cellAt(s.plan.decks[0], { row: 3, col: 2 })).toMatchObject({ label: '01', seatId: 's1' })
    expect(cellAt(s.plan.decks[0], { row: 2, col: 1 })).toBeUndefined()
    expect(s.selected).toEqual({ row: 3, col: 2 })
  })

  it('ignores a click on an empty cell when nothing is selected', () => {
    const s0 = initEditor(base(), false)
    expect(run(s0, { type: 'click', pos: { row: 3, col: 3 } })).toBe(s0)
  })

  it('nudges the selected cell with the arrow keys, swapping with a neighbour', () => {
    const s = run(
      initEditor(base(), false),
      { type: 'select', pos: { row: 2, col: 1 } },
      { type: 'nudge', dRow: 0, dCol: 1 },
    )
    expect(s.selected).toEqual({ row: 2, col: 2 })
    // off the grid: no-op
    expect(run(s, { type: 'nudge', dRow: -5, dCol: 0 })).toBe(s)
  })
})

describe('paint and erase', () => {
  it('paints a seat with the next free label and selects it', () => {
    const s = run(
      initEditor(base(), false),
      { type: 'tool', tool: 'seat' },
      { type: 'click', pos: { row: 3, col: 2 } },
    )
    expect(cellAt(s.plan.decks[0], { row: 3, col: 2 })).toMatchObject({ kind: 'seat', label: '03' })
    expect(s.selected).toEqual({ row: 3, col: 2 })
    expect(sellableCount(s.plan)).toBe(3)
  })

  it('keeps the label and seat id when repainting a seat as a berth', () => {
    const s = run(
      initEditor(base(), false),
      { type: 'tool', tool: 'bed' },
      { type: 'click', pos: { row: 2, col: 1 } },
    )
    expect(cellAt(s.plan.decks[0], { row: 2, col: 1 })).toMatchObject({
      kind: 'bed',
      label: '01',
      seatId: 's1',
    })
  })

  it('keeps one driver per deck: painting a new one moves it', () => {
    const s = run(
      initEditor(base(), false),
      { type: 'tool', tool: 'driver' },
      { type: 'click', pos: { row: 1, col: 3 } },
    )
    const drivers = s.plan.decks[0].cells.filter((c) => c.kind === 'driver')
    expect(drivers).toEqual([{ row: 1, col: 3, kind: 'driver' }])
  })

  it('erases a cell', () => {
    const s = run(
      initEditor(base(), false),
      { type: 'tool', tool: 'erase' },
      { type: 'click', pos: { row: 2, col: 3 } },
    )
    expect(sellableCount(s.plan)).toBe(1)
  })
})

describe('a layout in use keeps its seat set', () => {
  const locked = () => initEditor(base(), true)

  it('cannot add a seat on an empty cell or turn a fixture into a seat', () => {
    const s = run(locked(), { type: 'tool', tool: 'seat' })
    expect(run(s, { type: 'click', pos: { row: 3, col: 2 } }).plan).toBe(s.plan)
    expect(run(s, { type: 'click', pos: { row: 1, col: 1 } }).plan).toBe(s.plan)
  })

  it('cannot erase a seat, but may erase and add fixtures', () => {
    const erase = run(locked(), { type: 'tool', tool: 'erase' })
    expect(run(erase, { type: 'click', pos: { row: 2, col: 1 } }).plan).toBe(erase.plan)
    expect(sellableCount(run(erase, { type: 'click', pos: { row: 1, col: 1 } }).plan)).toBe(2)
    const door = run(
      locked(),
      { type: 'tool', tool: 'door' },
      { type: 'click', pos: { row: 1, col: 3 } },
    )
    expect(cellAt(door.plan.decks[0], { row: 1, col: 3 })?.kind).toBe('door')
  })

  it('may re-class a seat as a berth, relabel it and move it', () => {
    let s = run(locked(), { type: 'select', pos: { row: 2, col: 1 } })
    s = run(s, { type: 'patch', patch: { kind: 'bed' } }, { type: 'patch', patch: { label: 'Z9' } })
    expect(cellAt(s.plan.decks[0], { row: 2, col: 1 })).toMatchObject({
      kind: 'bed',
      label: 'Z9',
      seatId: 's1',
    })
    s = run(s, { type: 'click', pos: { row: 3, col: 1 } })
    expect(cellAt(s.plan.decks[0], { row: 3, col: 1 })?.seatId).toBe('s1')
  })

  it('cannot turn a seat into a fixture, shrink away a seat, or change decks', () => {
    const s = run(locked(), { type: 'select', pos: { row: 2, col: 1 } })
    expect(run(s, { type: 'patch', patch: { kind: 'wc' } }).plan).toBe(s.plan)
    expect(run(s, { type: 'resize', rows: 1, cols: 3 }).plan).toBe(s.plan)
    expect(run(s, { type: 'addDeck' }).plan).toBe(s.plan)
    expect(run(s, { type: 'renumber' }).plan).toBe(s.plan)
    // but a resize that only trims empty space is fine
    expect(run(s, { type: 'resize', rows: 2, cols: 3 }).plan.decks[0].rows).toBe(2)
  })
})

describe('patching the selected cell', () => {
  it('turning a seat into a fixture drops its label and seat id', () => {
    const s = run(
      initEditor(base(), false),
      { type: 'select', pos: { row: 2, col: 1 } },
      { type: 'patch', patch: { kind: 'stairs' } },
    )
    expect(cellAt(s.plan.decks[0], { row: 2, col: 1 })).toEqual({ row: 2, col: 1, kind: 'stairs' })
  })

  it('turning a fixture into a seat gives it a fresh label', () => {
    const s = run(
      initEditor(base(), false),
      { type: 'select', pos: { row: 1, col: 1 } },
      { type: 'patch', patch: { kind: 'seat' } },
    )
    expect(cellAt(s.plan.decks[0], { row: 1, col: 1 })).toMatchObject({ kind: 'seat', label: '03' })
  })
})

describe('decks and history', () => {
  it('adds an upper deck cloned from the lower, then removes it', () => {
    let s = run(initEditor(base(), false), { type: 'addDeck' })
    expect(s.plan.decks).toHaveLength(2)
    expect(s.deck).toBe(1)
    expect(s.plan.decks[1].cells.map((c) => c.label)).toEqual(['B01', 'B02'])
    expect(s.plan.decks[0].cells.map((c) => c.label)).toContain('A01')
    s = run(s, { type: 'removeDeck' })
    expect(s.plan.decks).toHaveLength(1)
    expect(s.deck).toBe(0)
    // the last deck cannot be removed
    expect(run(s, { type: 'removeDeck' }).plan).toBe(s.plan)
  })

  it('mirrors the active deck', () => {
    const s = run(initEditor(base(), false), { type: 'mirror' })
    expect(cellAt(s.plan.decks[0], { row: 1, col: 3 })?.kind).toBe('driver')
  })

  it('undoes and redoes structural edits but not selection or tool changes', () => {
    const start = initEditor(base(), false)
    let s = run(start, { type: 'tool', tool: 'seat' }, { type: 'click', pos: { row: 3, col: 2 } })
    expect(s.past).toHaveLength(1)
    s = run(s, { type: 'select', pos: null }, { type: 'tool', tool: 'select' })
    expect(s.past).toHaveLength(1)

    s = run(s, { type: 'undo' })
    expect(s.plan).toBe(start.plan)
    expect(s.future).toHaveLength(1)
    s = run(s, { type: 'redo' })
    expect(sellableCount(s.plan)).toBe(3)
    // nothing to undo / redo at the ends
    expect(run(start, { type: 'undo' })).toBe(start)
    expect(run(s, { type: 'redo' })).toBe(s)
  })

  it('applying a template replaces the plan as one undoable step', () => {
    const tpl = plan([seat(1, 1, 'X1')], 1, 1)
    const s = run(initEditor(base(), false), { type: 'replace', plan: tpl })
    expect(s.plan).toBe(tpl)
    expect(run(s, { type: 'undo' }).plan).not.toBe(tpl)
  })
})
