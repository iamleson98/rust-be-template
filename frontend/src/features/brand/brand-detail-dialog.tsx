'use client'

import { useQuery } from '@tanstack/react-query'
import { brandDetailOptions, reviewsStatsOptions, routesOptions } from '@/api'
import { useSearchForm } from '@/stores/search-form'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertCircle, Loader2, MessageSquareQuote, Route as RouteIcon } from 'lucide-react'
import { buildSearchInput } from '@/lib/search-params'
import { ReviewsList } from '@/features/reviews/reviews-list'
import { BrandDialogHeader } from './brand-dialog-header'
import { BrandRoutesTab } from './brand-routes-tab'

/**
 * A brand's public profile: who they are, the routes they run and what
 * customers say. Every number comes from the server — routes and their
 * daily departures from the brand's routes, ratings from its approved
 * reviews. Full screen on phones.
 */
export function BrandDetailDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const navigate = useNavigate()
  const setSearchParams = useSearchForm((s) => s.setSearchParams)
  const t = useT()
  const [tab, setTab] = useState('routes')

  const brandQuery = useQuery(brandDetailOptions({ path: { slug } }))
  const brand = brandQuery.data
  const routesQuery = useQuery({
    ...routesOptions({ query: { brand_id: brand?.id } }),
    enabled: !!brand,
  })
  const routes = routesQuery.data?.items ?? []
  const statsQuery = useQuery({
    ...reviewsStatsOptions({ query: { brand_id: brand?.id } }),
    enabled: !!brand,
  })
  const reviewCount = statsQuery.data?.count ?? 0

  const accent = brand?.accentColor ?? '#2563eb'

  // Search this route from tomorrow.
  const quickSearch = (fromName: string, toName: string) => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const date = tomorrow.toISOString().slice(0, 10)
    setSearchParams({ from: fromName, to: toName, date })
    onClose()
    navigate({ to: '/search', search: buildSearchInput({ from: fromName, to: toName, date }) })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92dvh] w-[95vw] max-w-3xl flex-col gap-0 overflow-hidden p-0 max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0">
        {!brand ? (
          <>
            <DialogTitle className="sr-only">{t('brandDetail.loadingTitle')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('brandDetail.loadingDesc')}
            </DialogDescription>
            <div className="flex h-64 flex-col items-center justify-center gap-2">
              {brandQuery.isError ? (
                <>
                  <AlertCircle className="size-8 text-rose-500" />
                  <p className="text-sm text-muted-foreground">{t('brandDetail.loadError')}</p>
                  <Button size="sm" variant="outline" onClick={() => brandQuery.refetch()}>
                    {t('payment.retry')}
                  </Button>
                </>
              ) : (
                <>
                  <Loader2 className="size-7 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">{t('brandDetail.loadingText')}</p>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <BrandDialogHeader
              brand={brand}
              accent={accent}
              reviewCount={reviewCount}
              routes={routes}
            />

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-background px-3 py-2">
                <TabsTrigger value="routes" className="flex-none gap-1.5">
                  <RouteIcon className="size-4" />
                  {t('admin.routes')}
                  <Badge variant="secondary" className="ml-0.5 text-[10px]">
                    {routes.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="reviews" className="flex-none gap-1.5">
                  <MessageSquareQuote className="size-4" />
                  {t('tripDetail.tabReviews')}
                  <Badge variant="secondary" className="ml-0.5 text-[10px]">
                    {reviewCount}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="min-h-0 flex-1">
                <BrandRoutesTab
                  isLoading={routesQuery.isLoading}
                  routes={routes}
                  accent={accent}
                  onQuickSearch={quickSearch}
                />
                <TabsContent value="reviews" className="m-0 p-4">
                  <ReviewsList brandId={brand.id} brandName={brand.name} accentColor={accent} />
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
