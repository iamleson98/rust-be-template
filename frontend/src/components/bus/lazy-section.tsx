'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * LazySection — delays rendering its children until the section is about to
 * enter the viewport (or has just entered). This keeps the initial page load
 * fast and, crucially, prevents the bundler from compiling every below-the-fold
 * section at once (which would spike memory in dev and bloat the initial
 * bundle in prod).
 *
 * Until the section is near the viewport, a lightweight placeholder (the
 * `fallback`) is rendered instead — zero JS from the children is shipped.
 */
export function LazySection({
  children,
  fallback,
  rootMargin = '400px',
  minHeight = 200,
}: {
  children: ReactNode
  fallback?: ReactNode
  /** Start loading when this close to the viewport. */
  rootMargin?: string
  /** Min height of the placeholder so layout doesn't jump. */
  minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  // If IntersectionObserver isn't available (SSR or legacy browser), render
  // immediately. Using a lazy initializer avoids calling setState in an effect.
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false
    return typeof IntersectionObserver === 'undefined'
  })

  useEffect(() => {
    if (visible) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin, visible])

  if (visible) {
    return <>{children}</>
  }
  return (
    <div ref={ref} style={{ minHeight }} aria-hidden="true">
      {fallback ?? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
        </div>
      )}
    </div>
  )
}
