'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBrand, useReviewsByBrand, usePopularRoutes } from '@/lib/queries'
import { apiJson } from '@/lib/api-client'
import { useNavigate } from '@/router'
import { useApp } from '@/lib/store'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Star,
  Phone,
  Mail,
  Bus,
  Route as RouteIcon,
  Clock,
  MapPin,
  MessageSquareQuote,
  Calendar,
  Navigation,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Quote,
  ThumbsUp,
  Sparkles,
  Smile,
  Armchair,
  ShieldCheck,
  Wallet,
  Wifi,
  Snowflake,
  Ticket as TicketIcon,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react'
import {
  formatDuration,
  formatDateTimeVN,
} from '@/lib/types'
import { buildSearchInput } from '@/lib/search-params'

// Extended Brand type — the centralized `Brand` type doesn't include the
// contact fields the `/api/brands/:slug` endpoint returns, so we extend it
// locally rather than mutating the shared type definition.
type BrandDetail = {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  description: string | null
  contactPhone: string | null
  contactEmail: string | null
  accentColor: string
  rating: number
  totalTrips?: number
  routeCount?: number
  status?: string
}

// Tag icon mapping — aligned to actual DB tag keys.
const TAG_ICONS: Record<string, LucideIcon> = {
  on_time: Clock,
  clean: Sparkles,
  friendly_driver: Smile,
  comfortable: Armchair,
  safe_drive: ShieldCheck,
  value: Wallet,
  good_wifi: Wifi,
  ac: Snowflake,
  easy_booking: TicketIcon,
}

type TagStat = {
  tag: string
  label: string
  emoji: string
  count: number
  percentage: number
}

type Review = {
  id: string
  rating: number
  title: string
  content: string
  tags: string[]
  authorName: string
  helpfulCount: number
  reply: string | null
  repliedAt: string | null
  createdAt: string
}

const TAG_LABELS: Record<string, string> = {
  on_time: 'Đúng giờ',
  clean: 'Sạch sẽ',
  friendly_driver: 'Tài xế thân thiện',
  comfortable: 'Thoải mái',
  value: 'Đáng đồng tiền',
  easy_booking: 'Đặt dễ',
  good_wifi: 'Wifi mạnh',
  safe_drive: 'Lái xe an toàn',
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function renderStars(rating: number, size = 'h-3.5 w-3.5') {
  const full = Math.floor(rating)
  const hasHalf = rating - full >= 0.3
  const stars = []
  for (let i = 0; i < 5; i++) {
    if (i < full) {
      stars.push(<Star key={i} className={`${size} fill-amber-400 text-amber-400`} />)
    } else if (i === full && hasHalf) {
      stars.push(<Star key={i} className={`${size} fill-amber-400/50 text-amber-400`} />)
    } else {
      stars.push(<Star key={i} className={`${size} text-muted-foreground/30`} />)
    }
  }
  return stars
}

type TagStatsResponse = { items: TagStat[] }

export function BrandDetailDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const navigate = useNavigate()
  const { setSearchParams } = useApp()
  const [tab, setTab] = useState('routes')

  // ── Brand identity + brand-wide reviews ──────────────────
  // useBrand is enabled only when slug is truthy; the dialog is only ever
  // rendered for a real slug (the route guards this), so this is always
  // enabled in practice.
  const brandQuery = useBrand(slug)
  const brand = brandQuery.data as BrandDetail | undefined

  // Reviews come back with the legacy field names (`content` / `photos` /
  // `reply` / `tags`) — the centralized ReviewItem type uses different
  // names, so we cast through unknown to our local Review shape.
  const reviewsQuery = useReviewsByBrand(brand?.id)
  const reviews: Review[] = (reviewsQuery.data?.items ?? []) as unknown as Review[]

  // ── Tag aggregate (brand-wide) ───────────────────────────
  // Backend `GET /api/reviews/tags` takes NO params — returns the global
  // tag index. We filter client-side by brandId if the items carry it.
  const tagStatsQuery = useQuery<TagStatsResponse>({
    queryKey: ['reviews', 'tags', 'brand', brand?.id ?? ''],
    queryFn: () => apiJson('/api/reviews/tags'),
    enabled: !!brand?.id,
    staleTime: 60 * 1000,
  })
  const tagStats: TagStat[] = (tagStatsQuery.data?.items ?? []).filter(
    (t) => !('brandId' in t) || (t as { brandId?: string }).brandId === brand?.id,
  )

  // ── Brand routes (filtered client-side from the popular routes cache) ──
  // The `/api/routes` endpoint doesn't support brand filtering, but each
  // route item carries a `brand.slug` so we filter on the client. This
  // reuses the same query cache as the homepage's popular-routes section
  // — no extra network round-trip if the user has already seen it.
  const routesQuery = usePopularRoutes()
  const routes = (routesQuery.data?.items ?? []).filter((r) => r.brand.slug === slug)

  // ── Derived aggregate stats ──────────────────────────────
  // The brand's `rating` field is the authoritative aggregate (the backend
  // recomputes it on every review write). For the 5-bucket distribution,
  // we approximate from the up-to-20 reviews we fetched — good enough for
  // the visual; precise enough because most brands have < 20 reviews.
  const distribution = [0, 0, 0, 0, 0]
  for (const r of reviews) {
    const idx = Math.max(0, Math.min(4, r.rating - 1))
    distribution[idx] += 1
  }
  const reviewCount = reviews.length
  const aggregate = {
    avgRating: brand?.rating ?? 0,
    count: reviewCount,
    distribution,
  }

  const accent = brand?.accentColor ?? '#2563eb'

  // ── Quick search — navigate to /search with from/to/date in the URL ──
  // The search route's validateSearch parses these and the SearchResults
  // page uses useTripSearch() to fetch. No manual state juggling.
  const quickSearch = (fromName: string, toName: string) => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const date = tomorrow.toISOString().slice(0, 10)
    setSearchParams({ from: fromName, to: toName, date })
    onClose()
    navigate({
      to: '/search',
      search: buildSearchInput({ from: fromName, to: toName, date }),
    })
  }

  const isLoading = brandQuery.isLoading
  const isError = brandQuery.isError

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[92vh] p-0 gap-0 overflow-hidden">
        {isLoading || !brand ? (
          <>
            <DialogTitle className="sr-only">Đang tải thông tin hãng xe</DialogTitle>
            <DialogDescription className="sr-only">
              Vui lòng đợi trong khi chúng tôi tải thông tin hãng xe.
            </DialogDescription>
            <div className="flex flex-col items-center justify-center h-64 gap-2">
              {isError ? (
                <>
                  <AlertCircle className="h-8 w-8 text-rose-500" />
                  <p className="text-sm text-muted-foreground">Không thể tải thông tin hãng xe</p>
                  <Button size="sm" variant="outline" onClick={() => brandQuery.refetch()}>
                    Thử lại
                  </Button>
                </>
              ) : (
                <>
                  <Loader2 className="h-7 w-7 animate-spin text-blue-700" />
                  <p className="text-sm text-muted-foreground">Đang tải thông tin hãng xe...</p>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Header — brand identity with accent color theming */}
            <div className="relative overflow-hidden">
              <div
                className="absolute inset-0 opacity-10"
                style={{
                  background: `linear-gradient(135deg, ${accent} 0%, transparent 60%)`,
                }}
              />
              {/* Accent color bar */}
              <div
                className="h-1.5 w-full"
                style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
              />
              <div className="px-5 py-4 relative">
                <div className="flex items-start gap-4">
                  {/* Logo / initials */}
                  <div
                    className="h-16 w-16 rounded-xl flex items-center justify-center text-white font-extrabold text-xl shrink-0"
                    style={{ background: accent }}
                  >
                    {brand.logoUrl ? (
                      <img
                        src={brand.logoUrl}
                        alt={brand.name}
                        className="h-11 w-11 object-contain"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      getInitials(brand.name)
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <DialogTitle className="text-xl font-extrabold tracking-tight">
                        {brand.name}
                      </DialogTitle>
                      {brand.status === 'active' && (
                        <Badge
                          className="text-[10px] gap-1 bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100"
                          variant="outline"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Đang hoạt động
                        </Badge>
                      )}
                    </div>
                    <DialogDescription className="sr-only">
                      Chi tiết hãng xe {brand.name}
                    </DialogDescription>

                    <div className="flex items-center gap-3 mt-1.5 text-sm flex-wrap">
                      <span className="flex items-center gap-1.5">
                        <span className="flex items-center gap-0.5">
                          {renderStars(brand.rating)}
                        </span>
                        <span className="font-semibold text-amber-600">
                          {brand.rating.toFixed(1)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({reviewCount} đánh giá)
                        </span>
                      </span>
                      {brand.contactPhone && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          {brand.contactPhone}
                        </span>
                      )}
                      {brand.contactEmail && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          {brand.contactEmail}
                        </span>
                      )}
                    </div>

                    {brand.description && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {brand.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-5 py-3 bg-slate-50/70 border-b">
              <StatCard
                icon={<RouteIcon className="h-4 w-4" />}
                label="Tuyến đường"
                value={routes.length}
                color={accent}
              />
              <StatCard
                icon={<Bus className="h-4 w-4" />}
                label="Chuyến / ngày"
                value={brand.totalTrips ?? 0}
                color={accent}
              />
              <StatCard
                icon={<Star className="h-4 w-4" />}
                label="Đánh giá TB"
                value={brand.rating.toFixed(1)}
                color="#f59e0b"
              />
              <StatCard
                icon={<MessageSquareQuote className="h-4 w-4" />}
                label="Lượt đánh giá"
                value={reviewCount}
                color="#2563eb"
              />
            </div>

            {/* Tabs */}
            <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="rounded-none border-b bg-white justify-start px-3 h-auto py-2 w-full">
                <TabsTrigger value="routes" className="gap-1.5">
                  <RouteIcon className="h-4 w-4" />
                  Tuyến đường
                  <Badge variant="secondary" className="text-[10px] ml-0.5">
                    {routes.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="reviews" className="gap-1.5">
                  <MessageSquareQuote className="h-4 w-4" />
                  Đánh giá
                  <Badge variant="secondary" className="text-[10px] ml-0.5">
                    {aggregate.count}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="fleet" className="gap-1.5">
                  <Bus className="h-4 w-4" />
                  Đội xe
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1 max-h-[55vh]">
                {/* Routes tab */}
                <TabsContent value="routes" className="p-4 m-0">
                  {routesQuery.isLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-600 mb-2" />
                      <p className="text-sm">Đang tải tuyến đường...</p>
                    </div>
                  ) : routes.length === 0 ? (
                    <EmptyState
                      icon={<RouteIcon className="h-7 w-7 text-slate-400" />}
                      title="Chưa có tuyến đường"
                      subtitle="Hãng chưa mở tuyến nào hoặc đang cập nhật."
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {routes.map((r) => (
                        <div
                          key={r.id}
                          className="group rounded-xl border bg-white hover:border-blue-400 transition-all p-3"
                        >
                          <div className="flex items-center gap-3">
                            {/* Route name */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 font-semibold text-sm">
                                <span className="truncate">{r.from.name}</span>
                                <ArrowRight
                                  className="h-3.5 w-3.5 text-blue-600 shrink-0"
                                  style={{ color: accent }}
                                />
                                <span className="truncate">{r.to.name}</span>
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDuration(r.durationMin)}
                                </span>
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {Math.round(r.distanceKm)} km
                                </span>
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {r.scheduleCount} chuyến/ngày
                                </span>
                              </div>
                            </div>

                            {/* Quick search button */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0 gap-1 border-blue-300 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600"
                              onClick={() => quickSearch(r.from.name, r.to.name)}
                            >
                              <Navigation className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Tìm chuyến</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Reviews tab */}
                <TabsContent value="reviews" className="p-4 m-0">
                  {reviewsQuery.isLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-600 mb-2" />
                      <p className="text-sm">Đang tải đánh giá...</p>
                    </div>
                  ) : reviewsQuery.isError ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <AlertCircle className="h-7 w-7 text-rose-500 mb-2" />
                      <p className="text-sm text-muted-foreground mb-3">Không thể tải đánh giá</p>
                      <Button size="sm" variant="outline" onClick={() => reviewsQuery.refetch()}>
                        Thử lại
                      </Button>
                    </div>
                  ) : aggregate.count === 0 ? (
                    <EmptyState
                      icon={<MessageSquareQuote className="h-7 w-7 text-slate-400" />}
                      title="Chưa có đánh giá"
                      subtitle={`Hãy là người đầu tiên đánh giá chuyến đi với ${brand.name}.`}
                    />
                  ) : (
                    <div className="space-y-4">
                      {/* Aggregate */}
                      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 p-4 rounded-xl bg-linear-to-br from-amber-50 to-orange-50 ring-1 ring-amber-200/50">
                        <div className="flex flex-col items-center justify-center text-center md:border-r md:border-amber-200/50">
                          <div className="text-5xl font-extrabold text-amber-600 tabular-nums">
                            {aggregate.avgRating.toFixed(1)}
                          </div>
                          <div className="flex items-center gap-0.5 mt-1">
                            {renderStars(aggregate.avgRating, 'h-4 w-4')}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {aggregate.count.toLocaleString('vi-VN')} đánh giá
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                            Phân bố sao
                          </div>
                          {[5, 4, 3, 2, 1].map((star) => {
                            const count = aggregate.distribution[star - 1] ?? 0
                            const pct =
                              aggregate.count > 0
                                ? Math.round((count / aggregate.count) * 100)
                                : 0
                            return (
                              <div key={star} className="flex items-center gap-2">
                                <div className="flex items-center gap-0.5 w-10">
                                  <span className="text-xs text-muted-foreground">{star}</span>
                                  <Star className="h-3 w-3 fill-amber-300 text-amber-300" />
                                </div>
                                <div className="h-2 flex-1 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-amber-400 rounded-full transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">
                                  {count}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Tag aggregate stats —"Đặc điểm được khen nhiều"*/}
                      {tagStats.length > 0 && (
                        <BrandTagStats tagStats={tagStats.slice(0, 5)} accentColor={accent} />
                      )}

                      {/* Recent reviews */}
                      <div>
                        <div className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                          <MessageSquareQuote className="h-4 w-4 text-amber-500" />
                          Đánh giá gần đây
                        </div>
                        <div className="space-y-3">
                          {reviews.map((r) => (
                            <div
                              key={r.id}
                              className="rounded-xl bg-white ring-1 ring-black/5 p-4"
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className="h-9 w-9 rounded-full text-white inline-flex items-center justify-center text-sm font-bold shrink-0"
                                  style={{
                                    background: `linear-gradient(135deg, ${accent}, ${accent}dd)`,
                                  }}
                                >
                                  {r.authorName?.slice(0, 1).toUpperCase() ?? 'A'}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-sm">{r.authorName}</span>
                                    <div className="flex items-center gap-0.5">
                                      {[1, 2, 3, 4, 5].map((n) => (
                                        <Star
                                          key={n}
                                          className={`h-3 w-3 ${n <= r.rating
                                              ? 'fill-amber-400 text-amber-400'
                                              : 'fill-slate-200 text-slate-200'
                                            }`}
                                        />
                                      ))}
                                    </div>
                                    <span className="text-xs text-muted-foreground">•</span>
                                    <span className="text-xs text-muted-foreground">
                                      {formatDateTimeVN(r.createdAt)}
                                    </span>
                                  </div>
                                  {r.title && (
                                    <div className="font-medium text-sm mt-1">{r.title}</div>
                                  )}
                                  {r.content && (
                                    <div className="text-sm text-muted-foreground mt-1 leading-relaxed">
                                      <Quote className="inline h-3 w-3 mr-1 text-slate-400" />
                                      {r.content}
                                    </div>
                                  )}
                                  {r.tags.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {r.tags.map((t) => (
                                        <Badge
                                          key={t}
                                          variant="outline"
                                          className="text-[10px] bg-slate-50 font-normal"
                                        >
                                          {TAG_LABELS[t] ?? t}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {r.reply && (
                                    <div
                                      className="mt-3 ml-3 pl-3 border-l-2"
                                      style={{ borderColor: accent }}
                                    >
                                      <div className="text-xs font-semibold flex items-center gap-1">
                                        <span
                                          className="inline-flex h-5 w-5 rounded-full items-center justify-center text-[10px] text-white"
                                          style={{ background: accent }}
                                        >
                                          {brand.name.slice(0, 1)}
                                        </span>
                                        Phản hồi từ {brand.name}
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-1">
                                        {r.reply}
                                      </p>
                                    </div>
                                  )}
                                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                                    <ThumbsUp className="h-3 w-3" />
                                    Hữu ích ({r.helpfulCount})
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Fleet tab — no public endpoint available, show empty state */}
                <TabsContent value="fleet" className="p-4 m-0">
                  <EmptyState
                    icon={<Bus className="h-7 w-7 text-slate-400" />}
                    title="Chưa có thông tin đội xe"
                    subtitle="Hãng chưa cập nhật danh sách xe."
                  />
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  color: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-white ring-1 ring-black/5 px-3 py-2">
      <div
        className="h-8 w-8 rounded-md flex items-center justify-center text-white shrink-0"
        style={{ background: color }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-base font-bold leading-tight tabular-nums">{value}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
          {label}
        </div>
      </div>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div className="text-center py-10">
      <div className="inline-flex h-14 w-14 rounded-full bg-slate-100 items-center justify-center mb-3">
        {icon}
      </div>
      <h4 className="font-semibold mb-1">{title}</h4>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{subtitle}</p>
    </div>
  )
}

// ── Tag aggregate stats section (brand-wide, shown in reviews tab) ──
function BrandTagStats({ tagStats, accentColor }: { tagStats: TagStat[]; accentColor: string }) {
  return (
    <div className="rounded-xl bg-linear-to-br from-blue-50 to-blue-50 ring-1 ring-blue-200/50 p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <h4 className="text-sm font-semibold text-blue-800">Đặc điểm được khen nhiều</h4>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Top {tagStats.length} nổi bật nhất
        </span>
      </div>
      <div className="space-y-2.5">
        {tagStats.map((t) => {
          const Icon = TAG_ICONS[t.tag] ?? Star
          return (
            <div key={t.tag} className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 w-40 sm:w-48 shrink-0">
                <div
                  className="h-7 w-7 rounded-md flex items-center justify-center text-white shrink-0"
                  style={{ background: accentColor }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate text-slate-700">{t.label}</div>
                  <div className="text-[10px] text-muted-foreground">{t.count} lượt nhắc</div>
                </div>
              </div>
              <div className="flex-1 h-2.5 bg-white/70 rounded-full overflow-hidden ring-1 ring-blue-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${accentColor}, ${accentColor}cc)`,
                  }}
                />
              </div>
              <span
                className="text-xs font-bold tabular-nums w-10 text-right"
                style={{ color: accentColor }}
              >
                {t.percentage}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
