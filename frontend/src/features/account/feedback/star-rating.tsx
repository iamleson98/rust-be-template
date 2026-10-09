import { memo } from 'react'
import { Star } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

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
  const t = useT()
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      aria-label={t('feedbackForm.starsOutOf5', { value })}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            px,
            i < value ? 'fill-amber-400 text-amber-400' : 'fill-muted text-muted-foreground/25',
          )}
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
