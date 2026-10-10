import { Bus } from 'lucide-react'
import { cn } from '@/lib/utils'

const SIZES = {
  lg: 'size-11 rounded-xl [&>svg]:size-5',
  md: 'size-10 rounded-xl [&>svg]:size-5',
  sm: 'size-9 rounded-lg [&>svg]:size-4',
  xs: 'size-8 rounded-lg [&>svg]:size-4',
}

const DEFAULT_ACCENT = '#2563eb'

/** An operator's brand colour as a bus icon tile; `tint` = pale background with a coloured icon. */
export function BusTile({
  accent,
  size,
  tint,
}: {
  accent?: string | null
  size: keyof typeof SIZES
  tint?: boolean
}) {
  const color = accent || DEFAULT_ACCENT
  return (
    <div
      className={cn('grid shrink-0 place-items-center', SIZES[size], !tint && 'text-white')}
      style={{
        background: tint
          ? `linear-gradient(135deg, ${color}22, ${color}11)`
          : `linear-gradient(135deg, ${color}, ${color}cc)`,
        color: tint ? color : undefined,
      }}
      aria-hidden
    >
      <Bus />
    </div>
  )
}
