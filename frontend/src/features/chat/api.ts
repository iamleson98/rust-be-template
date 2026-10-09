import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  listChannelsInfiniteOptions,
  listMessagesInfiniteOptions,
  type ChatChannelOut,
  type ChatMessageOut,
} from '@/api'

type Page = { items?: unknown[] }

/** Offset paging: a short page ends the list, otherwise continue after the loaded rows. */
const offsetPaging = (pageSize: number) => ({
  initialPageParam: 0,
  getNextPageParam: (last: Page, all: Page[]) =>
    (last.items?.length ?? 0) < pageSize
      ? undefined
      : all.reduce((loaded, page) => loaded + (page.items?.length ?? 0), 0),
})

/**
 * Pages arrive newest-first (`ORDER BY created_at DESC LIMIT/OFFSET`) and a new
 * message shifts later pages, so the same id can appear twice. Returns the
 * chronological list (oldest first, newest at the tail) with each id once,
 * keeping the copy from the newest page.
 */
export function flattenMessagePages<T extends { id: string }>(
  pages: ReadonlyArray<{ items?: T[] } | null | undefined>,
): T[] {
  const newest = new Map<string, T>()
  for (const page of pages) {
    for (const message of page?.items ?? [])
      if (!newest.has(message.id)) newest.set(message.id, message)
  }
  const seen = new Set<string>()
  const messages: T[] = []
  for (let p = pages.length - 1; p >= 0; p--) {
    for (const { id } of [...(pages[p]?.items ?? [])].reverse()) {
      if (seen.has(id)) continue
      seen.add(id)
      messages.push(newest.get(id)!)
    }
  }
  return messages
}

/** Support-queue channels, newest activity first, loaded `pageSize` at a time. */
export function useChatChannelsInfinite(pageSize: number) {
  const query = useInfiniteQuery({
    ...listChannelsInfiniteOptions({ query: { limit: pageSize } }),
    ...offsetPaging(pageSize),
  })
  const channels = useMemo(() => {
    const byId = new Map<string, ChatChannelOut>()
    for (const page of query.data?.pages ?? []) for (const c of page.items) byId.set(c.id, c)
    return [...byId.values()]
  }, [query.data])
  return {
    channels,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    error: query.error,
  }
}

/** One channel's messages in chronological order; older pages load on demand. */
export function useChatMessagesInfinite(channelId: string | undefined, pageSize = 30) {
  const query = useInfiniteQuery({
    ...listMessagesInfiniteOptions({ path: { id: channelId ?? '' }, query: { limit: pageSize } }),
    ...offsetPaging(pageSize),
    enabled: !!channelId,
  })
  const messages = useMemo(
    () => flattenMessagePages<ChatMessageOut>(query.data?.pages ?? []),
    [query.data],
  )
  return {
    messages,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: !!channelId && query.isLoading,
    error: query.error,
  }
}
