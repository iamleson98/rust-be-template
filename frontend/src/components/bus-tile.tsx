import { Bus } from 'lucide-react'
import { cn } from '@/lib/utils'

const SIZES = {
  lg: 'size-11 rounded-xl [&>svg]:size-5',
  md: 'size-10 rounded-xl [&>svg]:size-5',
  sm: 'size-9 rounded-lg [&>svg]:size-4',
  xs: 'size-8 rounded-lg [&>svg]:size-4',
}

/** A trip's bus icon tile in the brand blue; `tint` = pale background with a blue icon. */
export function BusTile({ size, tint }: { size: keyof typeof SIZES; tint?: boolean }) {
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center',
        SIZES[size],
        tint ? 'bg-primary/10 text-primary' : 'bg-primary text-primary-foreground',
      )}
      aria-hidden
    >
      <Bus />
    </div>
  )
}
