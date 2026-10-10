import type { ReactNode } from 'react'

/**
 * A booking step's buttons, pinned to the bottom of the scrolling step so
 * Back / Continue stay in reach however long the form is (and above the
 * home indicator on phones). Sits inside the step's `p-5` padding.
 */
export function StepActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 -mb-5 flex items-center justify-between gap-3 border-t bg-background px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      {children}
    </div>
  )
}
