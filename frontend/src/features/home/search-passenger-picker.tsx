'use client'

// Extracted from the original 'search-widget.tsx'.

import type { UseFormReturn } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Users, Minus, Plus } from 'lucide-react'
import type { SearchParams } from '@/lib/store'
import type { SearchFormValues } from './search-widget-schema'

export function SearchPassengerPicker({
  form,
  searchParams,
  setSearchParams,
  paxOpen,
  setPaxOpen,
}: {
  form: UseFormReturn<SearchFormValues>
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
  paxOpen: boolean
  setPaxOpen: React.Dispatch<React.SetStateAction<boolean>>
}) {
  return (
    <>
      {/* Passengers */}
      <FormField
        control={form.control}
        name="adults"
        render={({ field }) => (
          <FormItem className="space-y-1.5">
            <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pl-1">
              Khách
            </FormLabel>
            <div className="relative group/pax">
              <Users className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 z-10 text-muted-foreground group-hover/pax:text-blue-600 transition-colors" />
              <Popover open={paxOpen} onOpenChange={setPaxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start font-normal bg-white/95 h-10 pl-10"
                  >
                    {searchParams.adults + searchParams.children}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-4" align="start">
                  <div className="space-y-3">
                    <PaxRow
                      label="Người lớn"
                      sub="12 tuổi trở lên"
                      value={searchParams.adults}
                      onChange={(v) => {
                        const next = Math.max(1, v)
                        field.onChange(next)
                        setSearchParams({ adults: next })
                      }}
                    />
                    <PaxRow
                      label="Trẻ em"
                      sub="0 - 11 tuổi"
                      value={searchParams.children}
                      onChange={(v) => {
                        const next = Math.max(0, v)
                        form.setValue('children', next, { shouldValidate: false })
                        setSearchParams({ children: next })
                      }}
                    />
                    <Button type="button" className="w-full" onClick={() => setPaxOpen(false)}>
                      Xong
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

function PaxRow({ label, sub, value, onChange }: { label: string; sub: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-accent disabled:opacity-40"
          disabled={value <= 0}
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-6 text-center font-semibold">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
