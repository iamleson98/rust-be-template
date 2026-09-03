'use client'

/**
 * InfiniteSelect / InfiniteMultiSelect — searchable selects that page
 * data from the server as the user scrolls.
 *
 * Built on the Base UI `Combobox` primitive + a TanStack
 * `useInfiniteQuery`: when the scroll sentinel at the bottom of the
 * list comes into view, the next page is fetched and appended
 * (`fetchNextPage`), so very long backend lists (addresses, vehicle
 * types, …) stay fast — the client never loads everything at once.
 *
 * ## API
 *
 * ```tsx
 * <InfiniteSelect
 *   scope="brand-addresses"          // stable query-cache segment
 *   fetchPage={fetchAdminAddressesPage}  // (page, search) => { items, total, hasMore }
 *   value={field.value}
 *   onValueChange={field.onChange}
 *   itemValue={(a) => a.id}
 *   itemLabel={(a) => a.name}
 * />
 * ```
 *
 * ## Notes
 *
 * - **Search is server-side and throttled**: keystrokes are debounced
 *   (250 ms) into the query key and each request is wired to TanStack
 *   Query's `AbortSignal` — when the user keeps typing, the previous
 *   in-flight request is aborted instead of racing the new one, so the
 *   list never flickers with stale results and the API only sees one
 *   call per settled term.
 * - **`extraItems`** are merged (deduped by `itemValue`) in front of
 *   the fetched pages — pass items the picker must always show, e.g.
 *   the selected address on an edit form or one just created in a
 *   modal. They also feed the closed trigger's label.
 * - **Label resolution**: Base UI's Combobox would render the raw
 *   value (an id) in the trigger; we render the label ourselves from
 *   the resolved item (extras + fetched pages), with the raw value as
 *   the last-resort fallback.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query'
import { Loader2, SearchIcon } from 'lucide-react'

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

/** One page of the paginated list the component consumes. */
export interface InfinitePage<T> {
  items: T[]
  /** Total rows matching the current filter (server-side count). */
  total: number
  /** Whether a next page exists (offset + items.length < total). */
  hasMore: boolean
}

/**
 * (page, search, signal?) → one page of items. `page` is 0-based.
 *
 * `signal` is the TanStack Query abort signal — forward it to the HTTP
 * layer so a superseded search (user kept typing) cancels its request
 * instead of wasting bandwidth and racing the fresh result.
 */
export type InfiniteFetchPage<T> = (
  page: number,
  search: string,
  signal?: AbortSignal,
) => Promise<InfinitePage<T>>

/** Distance (px) before the list bottom that pre-triggers a page load. */
const LOAD_MORE_MARGIN = 200

type Size = 'sm' | 'default'

// ────────────────────────────────────────────────────────────────
//  Shared internals
// ────────────────────────────────────────────────────────────────

/** Shared infinite-query wiring for both select flavors. */
function useInfiniteOptions<T>(
  scope: string,
  fetchPage: InfiniteFetchPage<T>,
  search: string,
) {
  return useInfiniteQuery({
    queryKey: ['infinite-select', scope, search],
    // Forward TanStack Query's signal so superseded searches are
    // aborted at the HTTP level (see InfiniteFetchPage).
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam as number, search, signal),
    initialPageParam: 0 as number,
    getNextPageParam: (lastPage: InfinitePage<T>, allPages: Array<InfinitePage<T>>) =>
      lastPage.hasMore ? allPages.length : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  })
}

/** Merge extras in front of the fetched pages (deduped by itemValue). */
function useMergedItems<T>(
  pages: Array<InfinitePage<T>> | undefined,
  extraItems: T[] | undefined,
  itemValue: (item: T) => string,
): T[] {
  return useMemo(() => {
    const fetched = pages?.flatMap((p) => p.items) ?? []
    if (!extraItems?.length) return fetched
    const seen = new Set(fetched.map(itemValue))
    const extras = extraItems.filter((e) => !seen.has(itemValue(e)))
    return [...extras, ...fetched]
  }, [pages, extraItems, itemValue])
}

/** IntersectionObserver on the sentinel → fetchNextPage near bottom. */
function useLoadMoreSentinel(
  enabled: boolean,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  fetchNextPage: () => void,
) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const fetchRef = useRef(fetchNextPage)
  fetchRef.current = fetchNextPage

  useEffect(() => {
    if (!enabled) return
    const root = listRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) {
          fetchRef.current()
        }
      },
      // Watch from inside the scrolling list; start loading a bit
      // before the user actually hits the bottom.
      { root, rootMargin: `${LOAD_MORE_MARGIN}px` },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [enabled, hasNextPage, isFetchingNextPage])

  return { listRef, sentinelRef }
}

const listSurface = (className?: string) =>
  cn('max-h-72 overflow-y-auto overscroll-contain p-1', className)

function ListFooter({
  isLoading,
  isFetchingNextPage,
  hasItems,
}: {
  isLoading: boolean
  isFetchingNextPage: boolean
  hasItems: boolean
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tải…
      </div>
    )
  }
  if (isFetchingNextPage) {
    return (
      <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tải thêm…
      </div>
    )
  }
  if (!hasItems) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Không tìm thấy kết quả</div>
  }
  // All loaded — no footer; the list simply ends, matching the plain
  // Select / Combobox behaviour.
  return null
}

// ────────────────────────────────────────────────────────────────
//  Single select
// ────────────────────────────────────────────────────────────────

export interface InfiniteSelectProps<T> {
  /** Stable identity for the TanStack Query cache key. */
  scope: string
  fetchPage: InfiniteFetchPage<T>
  value: string | null | undefined
  onValueChange: (value: string | null) => void
  itemValue: (item: T) => string
  itemLabel: (item: T) => string
  /** Trigger rendering of the selected item (default: `itemLabel`). */
  renderValue?: (item: T | undefined, rawValue: string | null) => ReactNode
  /** Row rendering (default: `itemLabel`). */
  renderItem?: (item: T, selected: boolean) => ReactNode
  /** Items always available (selected-on-edit / just-created). */
  extraItems?: T[]
  placeholder?: string
  searchPlaceholder?: string
  /** Hide the search input (small fixed lists). Default: shown. */
  searchable?: boolean
  disabled?: boolean
  size?: Size
  className?: string
  id?: string
}

export function InfiniteSelect<T>({
  scope,
  fetchPage,
  value,
  onValueChange,
  itemValue,
  itemLabel,
  renderValue,
  renderItem,
  extraItems,
  placeholder = 'Chọn…',
  searchPlaceholder = 'Tìm kiếm…',
  searchable = true,
  disabled,
  size = 'default',
  className,
  id,
}: InfiniteSelectProps<T>) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)

  const query = useInfiniteOptions(scope, fetchPage, debouncedSearch)
  const items = useMergedItems(query.data?.pages, extraItems, itemValue)

  const selected = useMemo(
    () => items.find((i) => itemValue(i) === value),
    [items, value, itemValue],
  )

  const { listRef, sentinelRef } = useLoadMoreSentinel(
    true,
    !!query.hasNextPage,
    query.isFetchingNextPage,
    () => void query.fetchNextPage(),
  )

  const triggerLabel = renderValue
    ? renderValue(selected, value ?? null)
    : selected
      ? itemLabel(selected)
      : (value ?? placeholder)

  return (
    <Combobox
      value={value ?? ''}
      onValueChange={(v) => onValueChange(v || null)}
      onInputValueChange={(v) => setSearch(v)}
    >
      <ComboboxTrigger
        id={id}
        disabled={disabled}
        className={cn('w-full', size === 'sm' && 'h-8', className)}
      >
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 text-left',
            !selected && !value && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{triggerLabel}</span>
        </span>
      </ComboboxTrigger>
      <ComboboxContent>
        {searchable ? (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <ComboboxInput
              placeholder={searchPlaceholder}
              className="pl-9"
            />
          </div>
        ) : null}
        <ComboboxList ref={listRef} className={listSurface()}>
          {items.map((item) => {
            const v = itemValue(item)
            return (
              <ComboboxItem key={v} value={v}>
                {renderItem ? (
                  renderItem(item, v === value)
                ) : (
                  <span className="truncate">{itemLabel(item)}</span>
                )}
              </ComboboxItem>
            )
          })}
          <ListFooter
            isLoading={query.isLoading}
            isFetchingNextPage={query.isFetchingNextPage}
            hasItems={items.length > 0}
          />
          {/* Scroll sentinel — observed from within the list. */}
          <div ref={sentinelRef} aria-hidden className="h-px" />
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

// ────────────────────────────────────────────────────────────────
//  Multi select
// ────────────────────────────────────────────────────────────────

export interface InfiniteMultiSelectProps<T> {
  scope: string
  fetchPage: InfiniteFetchPage<T>
  values: string[]
  onValuesChange: (values: string[]) => void
  itemValue: (item: T) => string
  itemLabel: (item: T) => string
  renderItem?: (item: T, selected: boolean) => ReactNode
  extraItems?: T[]
  placeholder?: string
  searchPlaceholder?: string
  searchable?: boolean
  disabled?: boolean
  size?: Size
  className?: string
  /** Max badges rendered in the trigger before "+N". Default 2. */
  maxBadges?: number
  id?: string
}

export function InfiniteMultiSelect<T>({
  scope,
  fetchPage,
  values,
  onValuesChange,
  itemValue,
  itemLabel,
  renderItem,
  extraItems,
  placeholder = 'Chọn…',
  searchPlaceholder = 'Tìm kiếm…',
  searchable = true,
  disabled,
  size = 'default',
  className,
  maxBadges = 2,
  id,
}: InfiniteMultiSelectProps<T>) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)

  const query = useInfiniteOptions(scope, fetchPage, debouncedSearch)
  const items = useMergedItems(query.data?.pages, extraItems, itemValue)

  const labelByValue = useMemo(() => {
    const m = new Map<string, string>()
    for (const item of items) m.set(itemValue(item), itemLabel(item))
    return m
  }, [items, itemValue, itemLabel])

  const { listRef, sentinelRef } = useLoadMoreSentinel(
    true,
    !!query.hasNextPage,
    query.isFetchingNextPage,
    () => void query.fetchNextPage(),
  )

  const selectedValues = useMemo(() => new Set(values), [values])
  const badges = values.slice(0, maxBadges)
  const overflow = values.length - badges.length

  return (
    <Combobox<string, true>
      multiple
      value={values}
      onValueChange={(next) => onValuesChange(next ?? [])}
      onInputValueChange={(v) => setSearch(v)}
    >
      <ComboboxTrigger
        id={id}
        disabled={disabled}
        className={cn('w-full', size === 'sm' && 'h-8', className)}
      >
        {values.length === 0 ? (
          <span className="flex-1 truncate text-left text-muted-foreground">{placeholder}</span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-left">
            {badges.map((v) => (
              <span
                key={v}
                className="inline-flex max-w-[10rem] items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <span className="truncate">{labelByValue.get(v) ?? v}</span>
              </span>
            ))}
            {overflow > 0 ? (
              <span className="text-xs text-muted-foreground">+{overflow}</span>
            ) : null}
          </span>
        )}
      </ComboboxTrigger>
      <ComboboxContent>
        {searchable ? (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <ComboboxInput
              placeholder={searchPlaceholder}
              className="pl-9"
            />
          </div>
        ) : null}
        <ComboboxList ref={listRef} className={listSurface()}>
          {items.map((item) => {
            const v = itemValue(item)
            return (
              <ComboboxItem key={v} value={v}>
                {renderItem ? (
                  renderItem(item, selectedValues.has(v))
                ) : (
                  <span className="truncate">{itemLabel(item)}</span>
                )}
              </ComboboxItem>
            )
          })}
          <ListFooter
            isLoading={query.isLoading}
            isFetchingNextPage={query.isFetchingNextPage}
            hasItems={items.length > 0}
          />
          <div ref={sentinelRef} aria-hidden className="h-px" />
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
