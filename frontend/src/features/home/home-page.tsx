/**
 * Home route — `/`
 *
 * Renders the marketing landing page: hero, discount campaigns,
 * recently-viewed, popular routes, brand showcase, testimonials,
 * recommendations.
 *
 * All sections are lazy-loaded islands (code-split). The hero is in the
 * shell bundle so it paints immediately; the rest stream in as chunks
 * download.
 */
import { lazy, Suspense } from 'react'
import { Hero } from '@/features/home/hero'
import { IslandFallback } from '../../components/island-fallback'

const CampaignSpotlight = lazy(() =>
  import('@/features/campaigns/campaign-spotlight').then((m) => ({
    default: m.CampaignSpotlight,
  })),
)
const RecentlyViewed = lazy(() =>
  import('@/features/home/recently-viewed').then((m) => ({ default: m.RecentlyViewed })),
)
const PopularRoutes = lazy(() =>
  import('@/features/home/popular-routes').then((m) => ({ default: m.PopularRoutes })),
)
const BrandShowcase = lazy(() =>
  import('@/features/brand/brand-showcase').then((m) => ({ default: m.BrandShowcase })),
)
const Testimonials = lazy(() =>
  import('@/features/home/testimonials').then((m) => ({ default: m.Testimonials })),
)
const Recommendations = lazy(() =>
  import('@/features/home/recommendations').then((m) => ({ default: m.Recommendations })),
)

export function HomePage() {
  return (
    <div className="pb-6">
      <Hero />
      {/* Nothing until there is a campaign: no placeholder band for a promo that may not exist. */}
      <Suspense fallback={null}>
        <CampaignSpotlight />
      </Suspense>
      <Suspense fallback={<IslandFallback minHeight={120} />}>
        <RecentlyViewed />
      </Suspense>
      <Suspense fallback={<IslandFallback minHeight={500} />}>
        <PopularRoutes />
      </Suspense>
      <Suspense fallback={<IslandFallback minHeight={300} />}>
        <BrandShowcase />
      </Suspense>
      <Suspense fallback={<IslandFallback minHeight={400} />}>
        <Testimonials />
      </Suspense>
      <Suspense fallback={<IslandFallback minHeight={300} />}>
        <Recommendations />
      </Suspense>
    </div>
  )
}
