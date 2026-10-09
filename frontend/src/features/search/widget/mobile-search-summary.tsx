'use client'

/**
 * Phone-sized stand-in for the compact search widget on /search: one summary
 * line (from → to · date · passengers) that opens the full form in a bottom
 * sheet, so the results are not pushed below the fold. The form instance
 * comes from the parent so fields are registered once.
 */

import type { UseFormReturn } from 'react-hook-form'
import { ArrowRight, CircleDot, MapPin, Search, SlidersHorizontal } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Form } from '@/components/ui/form'
import type { SearchParams } from '@/lib/search-params'
import { SearchRouteFields } from './route-fields'
import { SearchDateFields } from './date-fields'
import { SearchPassengerPicker } from './passenger-picker'
import { useState } from 'react'
import type { SearchFormValues } from './schema'

/** '2026-10-10' → '10/10' (Vietnamese short form). '' when unset. */
function shortDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

export function MobileSearchSummary({
  searchParams,
  setSearchParams,
  swap,
  onOpen,
  sheetOpen,
  setSheetOpen,
  form,
  onSubmit,
  submitting,
}: {
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
  swap: () => void
  onOpen: () => void
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  form: UseFormReturn<SearchFormValues>
  onSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>
  submitting: boolean
}) {
  const t = useT()
  const [paxOpen, setPaxOpen] = useState(false)
  const pax = (searchParams.adults ?? 1) + (searchParams.children ?? 0)
  const dateShort = shortDate(searchParams.date)

  return (
    <>
      {/* One-line summary — the entire sticky footprint on phones */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('searchPage.editSearch')}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 h-12 text-left shadow-none"
      >
        <CircleDot className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold truncate min-w-0 max-w-28">
          {searchParams.from || t('search.placeholder')}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <MapPin className="h-4 w-4 text-rose-600 shrink-0" />
        <span className="text-sm font-semibold truncate min-w-0 max-w-28 flex-1">
          {searchParams.to || t('search.placeholder')}
        </span>
        <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1.5">
          {dateShort && <span className="tabular-nums">{dateShort}</span>}
          <span aria-hidden>·</span>
          <span>
            {pax} {t('searchPage.paxCountUnit')}
          </span>
        </span>
        <SlidersHorizontal className="h-4 w-4 text-primary shrink-0" />
      </button>

      {/* Full form in a bottom sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] flex flex-col p-0 gap-0">
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="text-base">{t('search.title')}</SheetTitle>
            <SheetDescription className="sr-only">{t('search.title')}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
            <Form {...form}>
              {/* Not `contents`: the sheet needs a real block form element. */}
              <form
                onSubmit={onSubmit}
                className="space-y-3.5"
                noValidate
                aria-label={t('search.title')}
              >
                {/* stackedSwap: the swap button is normally desktop-only
                    (hidden in the stacked mobile layout) — in the sheet it
                    gets its own centered row between the two fields. */}
                <SearchRouteFields form={form} swap={swap} compact stackedSwap />
                <SearchDateFields
                  form={form}
                  searchParams={searchParams}
                  setSearchParams={setSearchParams}
                  compact
                />
                <SearchPassengerPicker
                  form={form}
                  searchParams={searchParams}
                  setSearchParams={setSearchParams}
                  paxOpen={paxOpen}
                  setPaxOpen={setPaxOpen}
                  compact
                />
                <Button
                  type="submit"
                  disabled={submitting}
                  className="h-12 w-full rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground gap-2 font-semibold"
                >
                  <Search className="h-4 w-4" />
                  <span>{submitting ? t('home.searching') : t('search.btn')}</span>
                </Button>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
