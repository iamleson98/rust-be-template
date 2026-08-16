/** Shared lazy-island fallback for route components. */
export function IslandFallback({ minHeight = 200 }: { minHeight?: number }) {
  return (
    <div
      style={{ minHeight }}
      aria-busy="true"
      className="flex items-center justify-center"
    >
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  )
}
