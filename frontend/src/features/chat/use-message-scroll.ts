import { useEffect, useLayoutEffect, useRef } from 'react'
import { useScrollEdge } from '@/hooks/use-scroll-edge'

/** Within this many px of the bottom the reader counts as following the conversation. */
const NEAR_BOTTOM = 80

type Options = {
  /** Chronological, newest last. */
  messages: { id: string }[]
  /** Anything rendered below the messages (typing dots); a change re-pins a reader at the bottom. */
  trailing?: unknown
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

/**
 * Chat scrolling for the element the returned ref is attached to: opens on the
 * newest message, follows new ones while the reader is at the bottom, keeps
 * their place when older messages are prepended, and loads them at the top.
 * Prepends and appends both grow the list, so they are told apart by which end changed.
 */
export function useMessageScroll({
  messages,
  trailing,
  hasMore,
  loadingMore,
  onLoadMore,
}: Options) {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const before = useRef({ first: null as string | null, last: null as string | null, height: 0 })

  useScrollEdge(ref, { edge: 'top', enabled: !!hasMore && !loadingMore, onEdge: onLoadMore })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const track = () => {
      following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM
    }
    el.addEventListener('scroll', track, { passive: true })
    return () => el.removeEventListener('scroll', track)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const first = messages[0]?.id ?? null
    const last = messages.at(-1)?.id ?? null
    const prev = before.current
    if (prev.first == null || first == null) {
      el.scrollTop = el.scrollHeight
      following.current = true
    } else if (first !== prev.first && last === prev.last) {
      el.scrollTop += Math.max(el.scrollHeight - prev.height, 0)
    } else if (following.current) {
      el.scrollTop = el.scrollHeight
    }
    before.current = { first, last, height: el.scrollHeight }
  }, [messages, trailing])

  return ref
}
