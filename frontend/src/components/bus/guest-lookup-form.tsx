'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  bookingCodeSchema,
  phoneSchema,
} from '@/lib/forms'
import { Ticket, Phone, Search, Loader2, History, X } from 'lucide-react'

/**
 * Lookup schema — at least one of (code, phone) must be provided.
 * If a value IS provided, it must pass the per-field format check.
 *
 * `code` and `phone` are optional (empty string is allowed); the
 * top-level `.refine` enforces "at least one is filled".
 */
export const lookupSchema = z
  .object({
    code: bookingCodeSchema.optional().or(z.literal('')),
    phone: phoneSchema.optional().or(z.literal('')),
  })
  .refine(
    (d) => (d.code ?? '').trim() !== '' || (d.phone ?? '').trim() !== '',
    {
      message: 'Vui lòng nhập mã vé hoặc số điện thoại',
      path: ['code'],
    },
  )

export type LookupValues = z.infer<typeof lookupSchema>

type Props = {
  searchCode: string
  setSearchCode: (s: string) => void
  searchPhone: string
  setSearchPhone: (s: string) => void
  loading: boolean
  doSearch: () => void
  recentSearches: string[]
  onRecentClick: (term: string) => void
  onRemoveRecent: (term: string) => void
}

/**
 * GuestLookupForm — the manual booking-code / phone lookup form.
 *
 * Extracted from my-bookings.tsx so the same form can be reused by both
 * the guest flow and the secondary "lookup another booking" panel inside
 * the logged-in user's bookings tab.
 *
 * Validation lives in `lookupSchema` (zod) wired to react-hook-form via
 * `zodResolver`. The public prop API is unchanged — the parent still owns
 * the `searchCode` / `searchPhone` strings, this component mirrors them
 * into the form and propagates every keystroke back upward so the parent's
 * `doSearch` callback can read the latest values.
 */
export function GuestLookupForm({
  searchCode,
  setSearchCode,
  searchPhone,
  setSearchPhone,
  loading,
  doSearch,
  recentSearches,
  onRecentClick,
  onRemoveRecent,
}: Props) {
  const form = useForm<LookupValues>({
    resolver: zodResolver(lookupSchema),
    defaultValues: { code: searchCode, phone: searchPhone },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })

  // Sync external prop → form state. This fires when the parent updates
  // the strings (e.g. when the user clicks a recent-search chip).
  //
  // The comparison guard avoids clobbering the form's internal state on
  // every keystroke — because we propagate every keystroke back up via
  // setSearchCode/setSearchPhone, the prop and the form value usually
  // move together; we only `reset` when they have actually diverged
  // (which would clear field errors and dirty state if done naively).
  useEffect(() => {
    const currentCode = form.getValues('code') ?? ''
    const currentPhone = form.getValues('phone') ?? ''
    if (currentCode !== searchCode || currentPhone !== searchPhone) {
      form.reset({ code: searchCode, phone: searchPhone })
    }
  }, [searchCode, searchPhone, form])

  const onSubmit = (values: LookupValues) => {
    // Keep the parent's state in sync (defensive — every keystroke already
    // propagated via the onChange handlers below, but this covers any
    // programmatic reset path that bypassed them).
    if ((values.code ?? '') !== searchCode) setSearchCode(values.code ?? '')
    if ((values.phone ?? '') !== searchPhone) setSearchPhone(values.phone ?? '')
    doSearch()
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="contents"
        noValidate
        aria-label="Tra cứu vé"
      >
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-end">
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem className="flex-1 space-y-2">
                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground pl-1">
                  Mã đặt vé
                </FormLabel>
                <div className="relative">
                  <Ticket className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-500 pointer-events-none" />
                  <FormControl>
                    <Input
                      value={field.value ?? ''}
                      onChange={(e) => {
                        field.onChange(e.target.value)
                        setSearchCode(e.target.value)
                      }}
                      onBlur={field.onBlur}
                      placeholder="VD: PT-9TWPZQ"
                      className="pl-12 h-13 font-mono uppercase text-base ring-1 ring-blue-200 focus-visible:ring-blue-400"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="hidden md:flex items-center pb-3 text-sm font-medium text-muted-foreground">
            hoặc
          </div>
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem className="flex-1 space-y-2">
                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground pl-1">
                  Số điện thoại
                </FormLabel>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-500 pointer-events-none" />
                  <FormControl>
                    <Input
                      value={field.value ?? ''}
                      onChange={(e) => {
                        field.onChange(e.target.value)
                        setSearchPhone(e.target.value)
                      }}
                      onBlur={field.onBlur}
                      placeholder="VD: 0901234567"
                      className="pl-12 h-13 text-base ring-1 ring-blue-200 focus-visible:ring-blue-400"
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            disabled={loading}
            className="h-13 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white gap-2.5 px-8 text-base font-semibold"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            Tìm kiếm
          </Button>
        </div>
      </form>

      {recentSearches.length > 0 && (
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground font-medium shrink-0">Tìm kiếm gần đây:</span>
          {recentSearches.map((term) => (
            <button
              key={term}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1 text-xs font-medium ring-1 ring-blue-200/60 transition-colors"
              onClick={() => onRecentClick(term)}
            >
              {term}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemoveRecent(term)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onRemoveRecent(term)
                  }
                }}
                className="h-3.5 w-3.5 rounded-full inline-flex items-center justify-center hover:bg-blue-200 transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </span>
            </button>
          ))}
        </div>
      )}
    </Form>
  )
}
