'use client'

import { memo } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Star, Bus, ChevronRight } from 'lucide-react'
import { useBrands, type Brand } from '@/lib/queries'
import { useNavigate } from '@/router'
import { ErrorState } from './empty-states'
import { BrandShowcaseSkeleton } from './skeletons'

export const BrandShowcase = memo(function BrandShowcase() {
  const { data, isLoading, isError, refetch } = useBrands()
  const navigate = useNavigate()
  // Map the API brand shape to what the card UI expects.
  // `BrandOut` doesn't expose `routeCount`, so we fall back to `totalTrips`.
  const brands: Brand[] = data?.items ?? []

  /** Get initials from brand name (up to 2 chars) */
  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  /** Render star rating */
  const renderStars = (rating: number) => {
    const full = Math.floor(rating)
    const hasHalf = rating - full >= 0.3
    const stars = []
    for (let i = 0; i < 5; i++) {
      if (i < full) {
        stars.push(
          <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
        )
      } else if (i === full && hasHalf) {
        stars.push(
          <Star key={i} className="h-3.5 w-3.5 fill-amber-400/50 text-amber-400" />
        )
      } else {
        stars.push(
          <Star key={i} className="h-3.5 w-3.5 text-muted-foreground/30" />
        )
      }
    }
    return stars
  }

  return (
    <section className="bg-white">
      <div className="container mx-auto px-4 py-12 md:py-16">
        {isLoading ? (
          <BrandShowcaseSkeleton count={5} />
        ) : isError ? (
          <ErrorState
            description="Không thể tải danh sách hãng xe. Vui lòng thử lại."
            onRetry={() => refetch()}
          />
        ) : brands.length === 0 ? null : (
          <>
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                    Đối tác hãng xe uy tín
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Hàng trăm hãng xe kết nối cả nước
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-blue-600 hover:text-blue-700 hidden sm:flex"
                >
                  Xem tất cả
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Horizontally scrollable brand cards */}
            <div className="relative">
              {/* Scroll container */}
              <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                {brands.map((brand) => (
                  <div
                    key={brand.id}
                    className="snap-start shrink-0 w-65 sm:w-70"
                  >
                    <Card className="group overflow-hidden border-border/60 shadow-sm hover:shadow-md hover:border-blue-400 transition-all duration-300 h-full">
                      {/* Accent color top bar */}
                      <div
                        className="h-1.5"
                        style={{
                          background: `linear-gradient(90deg, ${brand.accentColor ?? '#2563eb'}, transparent)`,
                        }}
                      />

                      <div className="p-4 flex flex-col gap-3">
                        {/* Brand logo/initials + name */}
                        <div className="flex items-center gap-3">
                          <div
                            className="h-11 w-11 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
                            style={{ backgroundColor: brand.accentColor ?? '#2563eb' }}
                          >
                            {brand.logoUrl ? (
                              <img
                                src={brand.logoUrl}
                                alt={brand.name}
                                className="h-8 w-8 object-contain"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              getInitials(brand.name)
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-base truncate">
                              {brand.name}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {renderStars(brand.rating ?? 0)}
                              <span className="text-xs font-medium text-amber-600 ml-1">
                                {(brand.rating ?? 0).toFixed(1)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Route count badge */}
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="text-xs gap-1 bg-blue-50 text-blue-700 border-blue-200/60 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40"
                          >
                            <Bus className="h-3 w-3" />
                            {brand.totalTrips} tuyến
                          </Badge>
                        </div>

                        {/* "Xem chuyến" button — navigates to /brands/$slug */}
                        <Button
                          size="sm"
                          className="mt-auto w-full bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() =>
                            navigate({
                              to: '/brands/$slug',
                              params: { slug: brand.slug },
                            })
                          }
                        >
                          Xem chuyến
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  </div>
                ))}
              </div>

              {/* Scroll fade indicators */}
              <div className="pointer-events-none absolute top-0 left-0 bottom-4 w-8 bg-linear-to-r from-background to-transparent" />
              <div className="pointer-events-none absolute top-0 right-0 bottom-4 w-8 bg-linear-to-l from-background to-transparent" />
            </div>
          </>
        )}
      </div>
    </section>
  )
})
