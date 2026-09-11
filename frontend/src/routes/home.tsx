/**
 * Home route — `/`
 *
 * Renders the marketing landing page: hero, recently-viewed, popular
 * routes, campaigns, features, brand showcase, testimonials,
 * recommendations, FAQ, app-download CTA.
 *
 * All sections are lazy-loaded islands (code-split). The hero is in the
 * shell bundle so it paints immediately; the rest stream in as chunks
 * download.
 */
import { lazy, Suspense } from 'react'
import { Hero } from '@/features/home/hero'
import { IslandFallback } from './_fallback'

const RecentlyViewed = lazy(() => import('@/features/home/recently-viewed').then((m) => ({ default: m.RecentlyViewed })))
const PopularRoutes = lazy(() => import('@/features/home/popular-routes').then((m) => ({ default: m.PopularRoutes })))
const CampaignsBanner = lazy(() => import('@/features/home/campaigns-banner').then((m) => ({ default: m.CampaignsBanner })))
const Features = lazy(() => import('@/features/home/features').then((m) => ({ default: m.Features })))
const BrandShowcase = lazy(() => import('@/features/brand/brand-showcase').then((m) => ({ default: m.BrandShowcase })))
const Testimonials = lazy(() => import('@/features/home/testimonials').then((m) => ({ default: m.Testimonials })))
const Recommendations = lazy(() => import('@/features/home/recommendations').then((m) => ({ default: m.Recommendations })))
const FaqSection = lazy(() => import('@/features/home/faq-section').then((m) => ({ default: m.FaqSection })))
// const AppDownload = lazy(() => import('@/features/home/app-download').then((m) => ({ default: m.AppDownload })))

export function HomePage() {
  return (
    <div>
      <Hero />
      <Suspense fallback={<IslandFallback minHeight={120} />}>
        <RecentlyViewed />
      </Suspense>
      <Suspense fallback={<IslandFallback minHeight={500} />}>
        <PopularRoutes />
      </Suspense>
      <Suspense fallback={<IslandFallback minHeight={200} />}>
        <CampaignsBanner />
      </Suspense>
      <Suspense fallback={<IslandFallback minHeight={300} />}>
        <Features />
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
      <Suspense fallback={<IslandFallback minHeight={400} />}>
        <FaqSection />
      </Suspense>
      {/* <Suspense fallback={<IslandFallback minHeight={300} />}>
        <AppDownload />
      </Suspense> */}
    </div>
  )
}
