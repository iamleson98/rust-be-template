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
    <div className="mt-3 flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500">
        <Bookmark className="size-3.5" />
        {t('searchPage.savedSearches', { count: items.length })}
      </span>
      {items.slice(0, 6).map((s) => (
        <span
          key={s.id}
          className="inline-flex shrink-0 items-center rounded-full bg-white py-0.5 pr-0.5 pl-3 text-xs ring-1 ring-slate-200"
        >
          <button
            onClick={() => onApply(s)}
            className="font-medium text-slate-700 hover:text-primary"
          >
            {s.from} → {s.to}
            <span className="ml-1 font-normal text-slate-400">{s.date}</span>
          </button>
          <button
            onClick={() => onRemove(s.id)}
            className="ml-0.5 grid size-7 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-rose-600"
            title={t('common.delete')}
            aria-label={t('common.delete')}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
    </div>
  )
}
