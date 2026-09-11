'use client'

import { memo, useEffect, useRef, useState, useCallback } from 'react'
import { Star, Quote, BadgeCheck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { TestimonialsSkeleton } from '@/features/home/components/testimonials-skeleton'

interface Testimonial {
  name: string
  location: string
  rating: number
  review: string
  date: string
}

const testimonials: Testimonial[] = [
  {
    name: 'Nguyễn Thị Mai',
    location: 'Hà Nội',
    rating: 5,
    review: 'Đặt vé limousine Hà Nội - Đà Nẵng, xe sạch sẽ ghế êm. Đặt online 5 phút xong!',
    date: '15/01/2025',
  },
  {
    name: 'Trần Văn Hùng',
    location: 'TP.HCM',
    rating: 5,
    review: 'Giá rẻ hơn mua tại bến xe đến 15%. Nhân viên hỗ trợ chat rất nhiệt tình.',
    date: '22/12/2024',
  },
  {
    name: 'Lê Thu Hà',
    location: 'Đà Nẵng',
    rating: 4,
    review: 'App dễ dùng, chọn ghế trực quan. Đi giường nằm Sài Gòn - Đà Lạt ngủ rất ngon.',
    date: '08/01/2025',
  },
  {
    name: 'Phạm Minh Đức',
    location: 'Hải Phòng',
    rating: 5,
    review: 'Hoàn vé nhanh chóng chỉ mất 2 phút. Dịch vụ chuyên nghiệp!',
    date: '30/11/2024',
  },
  {
    name: 'Hoàng Thị Lan',
    location: 'Nha Trang',
    rating: 5,
    review: 'Mã giảm giá TETSALE tiết kiệm được 200k. Chuyến đi Tết rất suôn sẻ.',
    date: '18/01/2025',
  },
  {
    name: 'Võ Thành Nam',
    location: 'Cần Thơ',
    rating: 4,
    review: 'So sánh giá nhiều hãng cùng lúc rất tiện. Chọn được chuyến giá tốt nhất.',
    date: '05/12/2024',
  },
]

/* Star distribution for aggregate bar (out of ~125000 reviews) */
const starDistribution = [
  { stars: 5, percent: 72 },
  { stars: 4, percent: 18 },
  { stars: 3, percent: 6 },
  { stars: 2, percent: 3 },
  { stars: 1, percent: 1 },
]

/* Generate initials from Vietnamese name */
function getInitials(name: string): string {
  const parts = name.split(' ')
  if (parts.length >= 2) {
    return parts[parts.length - 2][0] + parts[parts.length - 1][0]
  }
  return parts[0][0]
}

/* Deterministic color from name */
const avatarColors = [
  'bg-blue-500',
  'bg-blue-500',
  'bg-blue-500',
  'bg-blue-600',
  'bg-blue-600',
  'bg-blue-600',
  'bg-blue-700',
  'bg-blue-700',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

const StarRating = memo(function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 transition-colors ${i < rating
            ? 'fill-amber-400 text-amber-400'
            : 'fill-slate-200 text-slate-200'
            }`}
        />
      ))}
    </div>
  )
})

export const Testimonials = memo(function Testimonials() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [loading, setLoading] = useState(true)

  const handleMouseEnter = useCallback(() => setIsPaused(true), [])
  const handleMouseLeave = useCallback(() => setIsPaused(false), [])

  /* Show skeleton briefly while content mounts */
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 350)
    return () => clearTimeout(t)
  }, [])

  /* Auto-scrolling carousel for testimonial cards */
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    let animId: number
    let start: number | null = null
    const speed = 0.4 // px per frame at 60fps

    const step = (timestamp: number) => {
      if (!start) start = timestamp
      if (!isPaused) {
        container.scrollLeft += speed
        // Loop back when reaching the end
        if (container.scrollLeft >= container.scrollWidth - container.clientWidth) {
          container.scrollLeft = 0
        }
      }
      animId = requestAnimationFrame(step)
    }

    animId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(animId)
  }, [isPaused])

  if (loading) {
    return <TestimonialsSkeleton count={3} />
  }

  return (
    <section className="relative bg-white">
      <div className="container mx-auto px-4 py-16">
        {/* Subtle background pattern */}
        <div
          className="absolute inset-0 -z-10 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, oklch(0.556 0.13 250) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Section header */}
        <div




          className="text-center max-w-2xl mx-auto mb-10"
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 mb-3">
            ⭐ Đánh giá từ hành khách
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            Khách hàng nói gì về DatXeVui?
          </h2>
          <p className="text-muted-foreground mt-3">
            Hơn 125.000 hành khách tin dùng
          </p>
        </div>

        {/* Aggregate rating bar */}
        <div




          className="mb-10 max-w-2xl mx-auto"
        >
          <Card className="border-blue-100 bg-linear-to-br from-blue-50/80 to-blue-50/50">
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row items-center gap-5">
                {/* Big rating number */}
                <div className="flex flex-col items-center sm:items-center shrink-0">
                  <div className="text-5xl font-extrabold text-blue-700">4.8</div>
                  <StarRating rating={5} />
                  <div className="text-xs text-muted-foreground mt-1">trung bình</div>
                </div>

                {/* Star distribution bars */}
                <div className="flex-1 w-full space-y-1.5">
                  {starDistribution.map((s) => (
                    <div key={s.stars} className="flex items-center gap-2">
                      <span className="text-xs font-medium w-4 text-right text-blue-700">
                        {s.stars}
                      </span>
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                      <div className="flex-1 h-2.5 rounded-full bg-blue-100 overflow-hidden">
                        <div




                          className="h-full rounded-full bg-blue-500"
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-8">{s.percent}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Testimonial cards — auto-scrolling carousel */}
        <div
          ref={scrollRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="flex gap-5 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide"
          style={{ scrollbarWidth: 'none' }}
        >
          {/* Duplicate items for infinite scroll feel */}
          {[...testimonials, ...testimonials].map((t, i) => (
            <div
              key={i}
              className="snap-start shrink-0 w-75 sm:w-85"
            >
              <Card className="group h-full border-slate-100 relative overflow-hidden">
                {/* Quote mark decoration */}
                <Quote className="absolute -top-2 -right-2 h-16 w-16 text-blue-50 rotate-0 group-hover:text-blue-100 transition-colors" />
                {/* Gradient overlay on hover */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-linear-to-br from-blue-50/60 via-transparent to-amber-50/40 pointer-events-none" />
                {/* Top gradient stripe (subtle) */}
                <div className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-blue-400 via-blue-400 to-amber-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                <CardContent className="p-5 relative">
                  {/* Top row: avatar + name + location + date */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="relative shrink-0">
                      <div
                        className={`h-10 w-10 rounded-full ${getAvatarColor(t.name)} flex items-center justify-center text-white text-sm font-bold`}
                      >
                        {getInitials(t.name)}
                      </div>
                      {/* Verified badge */}
                      <BadgeCheck className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-white text-blue-500 ring-1 ring-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-sm truncate">{t.name}</span>
                        <BadgeCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      </div>
                      <div className="text-xs text-muted-foreground">{t.location}</div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">{t.date}</div>
                  </div>

                  {/* Star rating */}
                  <StarRating rating={t.rating} />

                  {/* Review text with quote marks */}
                  <p className="text-sm text-slate-600 leading-relaxed mt-3">
                    <span className="text-blue-400 text-lg leading-none">&ldquo;</span>
                    {t.review}
                    <span className="text-blue-400 text-lg leading-none">&rdquo;</span>
                  </p>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>

        {/* Bottom CTA hint */}
        <div




          className="text-center mt-8"
        >
          <span className="text-sm text-muted-foreground">
            Và hàng ngàn đánh giá khác trên{' '}
            <span className="font-semibold text-blue-600">Google</span>{' '}
            và{' '}
            <span className="font-semibold text-blue-600">Facebook</span>
          </span>
        </div>
      </div>
    </section>
  )
})
