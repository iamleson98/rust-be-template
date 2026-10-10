'use client'

import { Canvas } from './canvas'
import { Inspector } from './inspector'
import { Palette } from './palette'
import type { PlanEditorApi } from './use-plan-editor'

/** Palette · canvas · inspector. State lives in `usePlanEditor` so the host dialog can read and replace the plan. */
export function PlanEditor({ editor }: { editor: PlanEditorApi }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_minmax(0,1fr)_260px]">
      <Palette
        tool={editor.state.tool}
        onPick={(tool) => editor.dispatch({ type: 'tool', tool })}
      />
      <Canvas editor={editor} />
      <Inspector editor={editor} />
    </div>
  )
}
