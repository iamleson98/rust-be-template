'use client'

// Extracted from the original 'search-widget.tsx'.

import type { UseFormReturn } from 'react-hook-form'
import { ArrowRight, Repeat2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchParams } from '@/lib/store'
import type { SearchFormValues } from './search-widget-schema'

export function SearchTripTypeToggle({
  form,
  searchParams,
  setSearchParams,
}: {
  form: UseFormReturn<SearchFormValues>
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => {
            form.setValue('roundTrip', false)
            setSearchParams({ roundTrip: false })
          }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
            !searchParams.roundTrip
              ? 'bg-white text-primary'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <ArrowRight className="h-3.5 w-3.5" />
          Một chiều
        </button>
        <button
          type="button"
          onClick={() => {
            form.setValue('roundTrip', true)
            setSearchParams({ roundTrip: true })
          }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
            searchParams.roundTrip
              ? 'bg-white text-primary'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <Repeat2 className="h-3.5 w-3.5" />
          Khứ hồi
        </button>
      </div>
      {searchParams.roundTrip && (
        <span className="text-[11px] text-blue-600 font-medium hidden sm:inline">
          Tiết kiệm đến 10% khi đặt vé khứ hồi
        </span>
      )}
    </div>
  )
}
