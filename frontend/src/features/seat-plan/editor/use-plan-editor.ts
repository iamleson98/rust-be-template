import { useMemo, useReducer } from 'react'
import { cellAt, validatePlan, type PlanCell, type SeatPlan } from '../model'
import { editorReducer, initEditor } from './editor-state'

/** Editor state for one seat plan; `locked` = trips already sell its seats. */
export function usePlanEditor(initial: SeatPlan, locked: boolean) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initEditor(initial, locked))
  const issues = useMemo(() => validatePlan(state.plan), [state.plan])
  const deck = state.plan.decks[state.deck]
  const selectedCell: PlanCell | undefined = state.selected
    ? cellAt(deck, state.selected)
    : undefined
  return { state, dispatch, issues, deck, selectedCell, dirty: state.past.length > 0 }
}

export type PlanEditorApi = ReturnType<typeof usePlanEditor>
