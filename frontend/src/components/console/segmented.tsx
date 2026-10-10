import { cn } from '@/lib/utils'

/** A small set of mutually exclusive choices (7 / 30 / 90 days), the chosen one highlighted. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  /** Accessible name of the group. */
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border bg-card p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 rounded-md px-3 text-sm transition-colors',
              active
                ? 'bg-primary/10 font-semibold text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
