/**
 * Shared lazy-island fallback for route components. It holds the space at
 * once but shows its spinner only after a moment, so a chunk that arrives
 * quickly swaps in without a spinner flashing first.
 */
export function IslandFallback({ minHeight = 200 }: { minHeight?: number }) {
  return (
    <div style={{ minHeight }} aria-busy="true" className="flex items-center justify-center">
      <div className="delayed-reveal h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}
