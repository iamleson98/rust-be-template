import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Route, Star } from 'lucide-react'
import { brandsOptions } from '@/api'
import { ErrorState } from '@/components/error-state'
import { HomeSection, RAIL, RailSkeleton } from '@/features/home/section'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

/** The operators on the platform, each card opening its page (routes, reviews). */
export const BrandShowcase = memo(function BrandShowcase() {
  const { data, isLoading, isError, refetch } = useQuery(brandsOptions())
  const t = useT()
  const brands = data?.items ?? []

  if (isLoading) return <RailSkeleton count={4} />
  if (isError)
    return (
      <div className="page-x py-10">
        <ErrorState description={t('brandDetail.loadBrandsError')} onRetry={() => refetch()} />
      </div>
    )
  if (brands.length === 0) return null

  return (
    <HomeSection
      title={t('brandDetail.partnersTitle')}
      subtitle={t('brandDetail.partnersSubtitle')}
    >
      <div className={cn(RAIL, 'lg:grid-cols-4')}>
        {brands.map((brand) => (
          <Link
            key={brand.id}
            to="/brands/$slug"
            params={{ slug: brand.slug }}
            className="group flex items-center gap-3 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-slate-200/80 transition duration-200 hover:-translate-y-0.5 hover:shadow-float hover:ring-primary/30"
          >
            <span
              className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: brand.accentColor ?? '#2563eb' }}
            >
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt=""
                  className="size-9 object-contain"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                initials(brand.name)
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-900">{brand.name}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs whitespace-nowrap text-slate-500">
                {brand.rating != null ? (
                  <span className="inline-flex items-center gap-0.5 font-medium text-slate-700">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    {brand.rating.toFixed(1)}
                  </span>
                ) : (
                  <span>{t('brandDetail.noReviewsYet')}</span>
                )}
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Route className="size-3" />
                  {t('brands.routesCount', { count: brand.routeCount })}
                </span>
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-slate-300 transition-colors group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </HomeSection>
  )
})
