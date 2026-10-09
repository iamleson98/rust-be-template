import type { ComponentProps, ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

export const BlueCheckbox = ({ className, ...props }: ComponentProps<typeof Checkbox>) => (
  <Checkbox
    className={cn(
      'data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600',
      className,
    )}
    {...props}
  />
)

const SECTION_TITLE = 'mb-2 text-xs font-semibold uppercase text-muted-foreground'

export function FilterSection({
  title,
  first,
  children,
}: {
  title: string
  first?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn(!first && 'border-t pt-3')}>
      <div className={SECTION_TITLE}>{title}</div>
      {children}
    </div>
  )
}

export const CountChip = ({ n }: { n: number }) =>
  n > 0 ? (
    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {n}
    </span>
  ) : null

/** One checkbox option: a plain list row, or a bordered pill when `boxed`. */
export function CheckRow({
  checked,
  onChange,
  icon,
  count,
  boxed,
  children,
}: {
  checked: boolean
  onChange: () => void
  icon?: ReactNode
  count: number
  boxed?: boolean
  children: ReactNode
}) {
  if (boxed) {
    return (
      <label
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-all',
          checked
            ? 'border-blue-400 bg-blue-50 font-medium text-blue-700'
            : 'border-slate-200 hover:bg-slate-50',
        )}
      >
        <BlueCheckbox className="h-3.5 w-3.5" checked={checked} onCheckedChange={onChange} />
        {icon && <span className="shrink-0 text-blue-500">{icon}</span>}
        <span className="flex-1 truncate">{children}</span>
        <CountChip n={count} />
      </label>
    )
  }
  return (
    <label className="group flex cursor-pointer items-center gap-2 py-1 text-sm">
      <BlueCheckbox checked={checked} onCheckedChange={onChange} />
      <span className="flex flex-1 items-center gap-1.5 transition-colors group-hover:text-blue-700">
        {icon && <span className="text-blue-500">{icon}</span>}
        {children}
      </span>
      <CountChip n={count} />
    </label>
  )
}
