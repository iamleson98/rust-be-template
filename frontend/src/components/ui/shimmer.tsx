import { cn } from '@/lib/utils'

/**
 * Shimmer skeleton primitive — a placeholder block with the animated
 * `.shimmer` sweep overlay (keyframes + gradient defined in styles.css).
 * Light + dark mode aware. Shared by the layout skeletons, the admin
 * page loading states and the DataTable's loading surface so every
 * loading placeholder in the app speaks the same visual language.
 */
export function Shimmer({
  className,
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      data-slot="shimmer"
      aria-hidden
      className={cn(
        'shimmer rounded-md bg-slate-200/80 dark:bg-slate-800/70',
        className,
      )}
      style={style}
    />
  )
}
