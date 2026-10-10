'use client'

/**
 * Stand-in for the compact search widget on /search below lg (phones and
 * tablets): one summary (from → to, date, passengers) that opens the full form
 * in a bottom sheet, so the results are not pushed below the fold. The form instance
 * comes from the parent so fields are registered once.
 */

import type { UseFormReturn } from 'react-hook-form'
import { ArrowRight, Search } from 'lucide-react'
import { formatDateVN } from '@/lib/format'
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
import { useRef, useState } from 'react'
import type { SearchFormValues } from './schema'

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
  const formAreaRef = useRef<HTMLDivElement>(null)
  const pax = (searchParams.adults ?? 1) + (searchParams.children ?? 0)
  const dateLabel = searchParams.date
    ? formatDateVN(searchParams.date, { weekday: 'short', day: '2-digit', month: '2-digit' })
    : ''

  return (
    <>
      {/* The whole sticky footprint below lg: where, when, how many — tap to change. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('searchPage.editSearch')}
        className="flex w-full items-center gap-3 rounded-2xl bg-white py-2 pr-3 pl-2 text-left ring-1 ring-slate-200 transition-colors hover:ring-primary/40"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Search className="size-4" />
        </span>
        {searchParams.from || searchParams.to ? (
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-900">
              <span className="truncate">{searchParams.from || t('search.placeholder')}</span>
              <ArrowRight className="size-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{searchParams.to || t('search.placeholder')}</span>
            </span>
            <span className="block truncate text-xs text-slate-500">
              {dateLabel && <span className="tabular-nums">{dateLabel} · </span>}
              {pax} {t('searchPage.paxCountUnit')}
            </span>
          </span>
        ) : (
          // Nothing chosen yet: one prompt, not two clipped placeholders.
          <span className="min-w-0 flex-1 truncate text-sm text-slate-500">
            {t('searchPage.wherePrompt')}
          </span>
        )}
        {(searchParams.from || searchParams.to) && (
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
            {t('searchPage.change')}
          </span>
        )}
      </button>

      {/* Full form in a bottom sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        {/* Focus lands on the form, not the first field: opening the sheet
            must not pop the keyboard and the place suggestions over it. */}
        <SheetContent
          side="bottom"
          initialFocus={formAreaRef}
          className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:mx-auto sm:max-w-xl sm:rounded-t-3xl"
        >
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="text-base">{t('search.title')}</SheetTitle>
            <SheetDescription className="sr-only">{t('search.title')}</SheetDescription>
          </SheetHeader>
          <div
            ref={formAreaRef}
            tabIndex={-1}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 outline-none"
          >
            <Form {...form}>
              {/* Not `contents`: the sheet needs a real block form element. */}
              <form
                onSubmit={onSubmit}
                className="space-y-3"
                noValidate
                aria-label={t('search.title')}
              >
                {/* Stacked: one compact group, the swap button between the fields. */}
                <SearchRouteFields form={form} swap={swap} compact layout="stacked" />
                <div className="grid grid-cols-2 gap-3">
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
                </div>
                <Button type="submit" disabled={submitting} size="lg" className="h-11 w-full gap-2">
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
