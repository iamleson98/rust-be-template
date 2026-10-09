import { useEffect, useEffectEvent, type RefObject } from 'react'

type Options = {
  edge: 'top' | 'bottom'
  /** Distance in px from the edge that counts as reaching it. */
  threshold?: number
  enabled?: boolean
  onEdge?: () => void
}

/** Calls `onEdge` on scroll events while the element is within `threshold` px of its top or bottom. */
export function useScrollEdge(
  ref: RefObject<HTMLElement | null>,
  { edge, threshold = 80, enabled = true, onEdge }: Options,
) {
  const reached = useEffectEvent(() => onEdge?.())

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const onScroll = () => {
      const distance =
        edge === 'top' ? el.scrollTop : el.scrollHeight - el.scrollTop - el.clientHeight
      if (distance <= threshold) reached()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref, edge, threshold, enabled])
}
