/**
 * Star-rating primitives shared by the feedback surfaces.
 *
 *   <StarRating value={4} />        — read-only display (amber fills)
 *   <StarPicker value onChange />   — interactive 1–5 picker with hover
 *                                     states, emoji + label, spring pop
 *
 * Design notes: amber-400 fills (the established "rating" color across
 * the app — reviews-list, testimonials, feedback-form), a scale pop on
 * hover/selection for the "delightful" feel, keyboard accessible
 * (radiogroup semantics), and `prefers-reduced-motion` handled by the
 * global CSS rules.
 */
import { memo, useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Emoji + Vietnamese label for each rating level. */
export const RATING_META: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '😞', label: 'Rất tệ' },
  2: { emoji: '🙁', label: 'Tạm được' },
  3: { emoji: '🙂', label: 'Khá tốt' },
  4: { emoji: '😊', label: 'Rất tốt' },
  5: { emoji: '🤩', label: 'Tuyệt vời' },
}

/* ── Read-only display ─────────────────────────────────────────── */

export const StarRating = memo(function StarRating({
  value,
  size = 'md',
  showValue = false,
  className,
}: {
  value: number
  size?: 'sm' | 'md' | 'lg'
  showValue?: boolean
  className?: string
}) {
  const px = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-6 w-6' : 'h-4 w-4'
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${value} trên 5 sao`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(px, i < value ? 'fill-amber-400 text-amber-400' : 'fill-muted text-muted-foreground/25')}
        />
      ))}
      {showValue && (
        <span className="ml-1.5 text-sm font-semibold tabular-nums text-amber-600">
          {value.toFixed(1)}
        </span>
      )}
    </span>
  )
})

/* ── Interactive picker ─────────────────────────────────────────── */

export function StarPicker({
  value,
  onChange,
  size = 'lg',
  showLabel = true,
  className,
}: {
  value: number
  onChange: (next: number) => void
  size?: 'md' | 'lg' | 'xl'
  showLabel?: boolean
  className?: string
}) {
  const [hover, setHover] = useState(0)
  const active = hover || value
  const px =
    size === 'md' ? 'h-7 w-7' : size === 'xl' ? 'h-11 w-11' : 'h-9 w-9'
  const meta = RATING_META[active]

  return (
    <div className={cn('flex flex-col items-center gap-2.5 select-none', className)}>
      <div
        role="radiogroup"
        aria-label="Chọn số sao đánh giá"
        className="flex items-center gap-1.5"
        onMouseLeave={() => setHover(0)}
      >
        {Array.from({ length: 5 }).map((_, i) => {
          const star = i + 1
          const filled = star <= active
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={value === star}
              aria-label={`${star} sao — ${RATING_META[star].label}`}
              onMouseEnter={() => setHover(star)}
              onFocus={() => setHover(star)}
              onBlur={() => setHover(0)}
              onClick={() => onChange(star)}
              className={cn(
                'cursor-pointer rounded-full p-1 outline-none transition-transform duration-150',
                'hover:scale-125 focus-visible:scale-125 focus-visible:ring-2 focus-visible:ring-ring',
                filled && 'scale-110',
              )}
            >
              <Star
                className={cn(
                  px,
                  'transition-colors duration-150',
                  filled
                    ? 'fill-amber-400 text-amber-400 drop-shadow-[0_2px_4px_rgba(251,191,36,0.45)]'
                    : 'fill-transparent text-muted-foreground/40 hover:text-amber-300',
                )}
              />
            </button>
          )
        })}
      </div>
      {showLabel && (
        <div
          className={cn(
            'flex items-center gap-1.5 text-sm font-medium transition-opacity duration-150',
            active ? 'opacity-100' : 'opacity-0',
          )}
          aria-live="polite"
        >
          {active > 0 && (
            <>
              <span className="text-xl leading-none">{meta?.emoji}</span>
              <span className="text-amber-600">{meta?.label}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
