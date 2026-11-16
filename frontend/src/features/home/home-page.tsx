/**
 * Home route — `/`
 *
 * Renders the marketing landing page: hero, discount campaigns,
 * recently-viewed, popular routes, brand showcase, what we promise,
 * testimonials, recommendations.
 *
 * The sections are small and sit in the page's own chunk, so the page shows
 * whole the moment it mounts (a section per chunk meant a skeleton, then a
 * request each). Only the campaign band, which most days has nothing to
 * show, loads apart. The server has already written the first screen's text
 * and data into the HTML (see `entry-client.tsx`).
 */
import { lazy, Suspense } from 'react'
import { BrandShowcase } from '@/features/brand/brand-showcase'
import { Hero } from '@/features/home/hero'
import { PopularRoutes } from '@/features/home/popular-routes'
import { Recommendations } from '@/features/home/recommendations'
import { RecentlyViewed } from '@/features/home/recently-viewed'
import { Testimonials } from '@/features/home/testimonials'
import { TrustCommitments } from '@/features/home/trust-commitments'

// Only for a signed-in customer or a running campaign: nothing to show until then.
const CampaignSpotlight = lazy(() =>
  import('@/features/campaigns/campaign-spotlight').then((m) => ({
    default: m.CampaignSpotlight,
  })),
)

export function HomePage() {
  return (
    <div className="pb-6">
      <Hero />
      {/* Nothing until there is a campaign: no placeholder band for a promo that may not exist. */}
      <Suspense fallback={null}>
        <CampaignSpotlight />
      </Suspense>
      <RecentlyViewed />
      <PopularRoutes />
      <BrandShowcase />
      <TrustCommitments />
      <Testimonials />
      <Recommendations />
    </div>
  )
}
