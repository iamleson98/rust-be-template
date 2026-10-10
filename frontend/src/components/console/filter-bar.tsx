import { useState, type ReactNode } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type FilterAction = {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  /** A toggle (e.g. "show chart"): shown pressed while on. */
  pressed?: boolean
}

/** The search field every list page starts with. */
export function FilterSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const t = useT()
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 rounded-xl bg-white pr-9 pl-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label={t('adminTickets.clearFilter')}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * A list page's search, filters and actions in one row. Phones keep the
 * search and move the filters into a sheet behind one button (with how
 * many are on); actions shrink to icons.
 */
export function FilterBar({
  search,
  filters,
  actions = [],
  activeCount = 0,
  onReset,
  className,
}: {
  search?: ReactNode
  /** The filter fields (selects, date pickers). */
  filters?: ReactNode
  actions?: FilterAction[]
  /** Filters that differ from their defaults. */
  activeCount?: number
  onReset?: () => void
  className?: string
}) {
  const t = useT()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  if (!isMobile) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        {search && <div className="min-w-56 flex-1">{search}</div>}
        {filters}
        {actions.length > 0 && (
          <div className={cn('flex gap-2', !search && 'ml-auto')}>
            {actions.map((a, i) => (
              <Button
                key={i}
                variant={a.pressed ? 'secondary' : 'outline'}
                className={cn('h-10 rounded-xl', !a.pressed && 'bg-white')}
                aria-pressed={a.pressed}
                onClick={a.onClick}
                disabled={a.disabled}
              >
                {a.icon}
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {search && <div className="min-w-0 flex-1">{search}</div>}
      {filters && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              className={cn('h-10 shrink-0 gap-1.5 rounded-xl bg-white', !search && 'mr-auto')}
            >
              <SlidersHorizontal className="size-4" />
              {t('searchPage.filter')}
              {activeCount > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-2xl p-0">
            <SheetHeader className="border-b px-5 py-4">
              <SheetTitle>{t('searchPage.filters')}</SheetTitle>
              <SheetDescription className="sr-only">{t('searchPage.filters')}</SheetDescription>
            </SheetHeader>
            <div className="grid gap-3 overflow-y-auto px-5 py-4 [&>*]:w-full">{filters}</div>
            <div className="flex gap-2 border-t px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              {onReset && activeCount > 0 && (
                <Button variant="outline" className="h-11 rounded-xl" onClick={onReset}>
                  {t('searchPage.clearAll')}
                </Button>
              )}
              <Button className="h-11 flex-1 rounded-xl" onClick={() => setOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}
      {actions.map((a, i) => (
        <Button
          key={i}
          variant={a.pressed ? 'secondary' : 'outline'}
          size="icon"
          className={cn('size-10 shrink-0 rounded-xl', !a.pressed && 'bg-white')}
          aria-label={a.label}
          title={a.label}
          aria-pressed={a.pressed}
          onClick={a.onClick}
          disabled={a.disabled}
        >
          {a.icon}
        </Button>
      ))}
    </div>
  )
}
