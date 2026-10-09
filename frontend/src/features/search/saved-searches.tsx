'use client'

import { Bookmark, X } from 'lucide-react'
import { useT } from '@/lib/i18n'
import type { SavedSearch } from './use-saved-searches'

/** The user's starred searches as removable chips. */
export function SavedSearchesList({
  items,
  onApply,
  onRemove,
}: {
  items: SavedSearch[]
  onApply: (search: SavedSearch) => void
  onRemove: (id: string) => void
}) {
  const t = useT()
  return (
    <div className="mb-3 rounded-xl border bg-rose-50/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-rose-700">
        <Bookmark className="h-3.5 w-3.5" />
        {t('searchPage.savedSearches', { count: items.length })}
      </div>
      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
        {items.slice(0, 6).map((s) => (
          <div
            key={s.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-2 py-1 text-[11px]"
          >
            <button onClick={() => onApply(s)} className="font-medium text-rose-700 hover:underline">
              {s.from} → {s.to}
            </button>
            <span className="text-muted-foreground">• {s.date}</span>
            <button
              onClick={() => onRemove(s.id)}
              className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
              title={t('common.delete')}
              aria-label={t('common.delete')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
