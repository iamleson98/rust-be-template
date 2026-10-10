import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { History } from 'lucide-react'
import { relativeTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useGuest } from '@/stores/guest'

/** Trips opened lately on this device, one tap to reopen; absent until there are some. */
export const RecentlyViewed = memo(function RecentlyViewed() {
  const recentlyViewed = useGuest((s) => s.recentlyViewed)
  const t = useT()

  if (recentlyViewed.length === 0) return null

  return (
    <section className="page-x pt-10 md:pt-12">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <History className="size-4 text-slate-400" />
        {t('home.recentlyViewedTitle')}
      </h2>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
        {recentlyViewed.slice(0, 6).map((rv) => (
          <Link
            key={rv.tripId}
            to="/trips/$tripId"
            params={{ tripId: rv.tripId }}
            className="flex shrink-0 flex-col rounded-2xl bg-white px-4 py-2.5 shadow-soft ring-1 ring-slate-200/80 transition-colors hover:ring-primary/40"
          >
            <span className="max-w-60 truncate text-sm font-semibold text-slate-900">
              {rv.label}
            </span>
            <span className="text-xs text-slate-500">
              {rv.brandName} · {relativeTime(new Date(rv.seenAt).toISOString())}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
})
