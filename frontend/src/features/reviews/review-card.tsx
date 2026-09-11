'use client'

/**
 * ReviewCard — one review row of the ReviewsList (author avatar,
 * stars, comment, tag badges, photos, brand reply, helpful button),
 * plus the private ReviewPhotoGrid thumbnail strip (max 4 thumbs,
 * "+N more" overlay).
 *
 * Extracted from the original `reviews-list.tsx`.
 */

import { Star, ThumbsUp, Quote, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTimeVN } from '@/lib/types'

export type Review = {
  id: string
  rating: number
  title: string
  content: string
  tags: string[]
  photos?: string[]
  authorName: string
  helpfulCount: number
  reply: string | null
  repliedAt: string | null
  createdAt: string
}

const TAG_LABELS: Record<string, { label: string; emoji: string }> = {
  on_time: { label: 'Đúng giờ', emoji: '⏱️' },
  clean: { label: 'Sạch sẽ', emoji: '✨' },
  friendly_driver: { label: 'Tài xế thân thiện', emoji: '😊' },
  comfortable: { label: 'Thoải mái', emoji: '🛋️' },
  value: { label: 'Đáng đồng tiền', emoji: '💰' },
  easy_booking: { label: 'Đặt dễ', emoji: '🎟️' },
  good_wifi: { label: 'Wifi mạnh', emoji: '📶' },
  safe_drive: { label: 'Lái xe an toàn', emoji: '🛡️' },
}

export function ReviewCard({
  r,
  accentColor,
  brandName,
  helpfulMap,
  markHelpful,
  openLightbox,
}: {
  r: Review
  accentColor: string
  brandName: string
  helpfulMap: Record<string, boolean>
  markHelpful: (id: string) => void
  openLightbox: (images: string[], idx: number) => void
}) {
  return (
              <div
                key={r.id}
                className="rounded-xl bg-white ring-1 ring-black/5 p-4"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="h-10 w-10 rounded-full text-white inline-flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)` }}
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
                      <span className="text-xs text-muted-foreground">{formatDateTimeVN(r.createdAt)}</span>
                    </div>
                    {r.title && <div className="font-medium text-sm mt-1">{r.title}</div>}
                    {r.content && (
                      <div className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        <Quote className="inline h-3 w-3 mr-1 text-slate-400" />
                        {r.content}
                      </div>
                    )}
                    {r.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.tags.map((t) => {
                          const tl = TAG_LABELS[t]
                          return (
                            <Badge key={t} variant="outline" className="text-[10px] gap-1 bg-slate-50 font-normal">
                              {tl?.emoji ?? '🏷️'} {tl?.label ?? t}
                            </Badge>
                          )
                        })}
                      </div>
                    )}
                    {r.photos && r.photos.length > 0 && (
                      <ReviewPhotoGrid
                        photos={r.photos}
                        onOpen={(i) => openLightbox(r.photos!, i)}
                      />
                    )}
                    {r.reply && (
                      <div className="mt-3 ml-3 pl-3 border-l-2 space-y-1" style={{ borderColor: accentColor }}>
                        <div className="text-xs font-semibold flex items-center gap-1">
                          <span className="inline-flex h-5 w-5 rounded-full items-center justify-center text-[10px] text-white" style={{ background: accentColor }}>
                            {brandName.slice(0, 1)}
                          </span>
                          Phản hồi từ {brandName}
                        </div>
                        <p className="text-xs text-muted-foreground">{r.reply}</p>
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        onClick={() => markHelpful(r.id)}
                        disabled={helpfulMap[r.id]}
                        className={`inline-flex items-center gap-1 text-xs transition-colors ${helpfulMap[r.id] ? 'text-blue-600 cursor-default' : 'text-muted-foreground hover:text-blue-600'
                          }`}
                      >
                        <ThumbsUp className={`h-3 w-3 ${helpfulMap[r.id] ? 'fill-blue-100' : ''}`} />
                        Hữu ích ({r.helpfulCount})
                      </button>
                    </div>
                  </div>
                </div>
              </div>
  )
}

// ── Photo grid inside a review (max 4 thumbnails,"+N more"overlay) ──
function ReviewPhotoGrid({ photos, onOpen }: { photos: string[]; onOpen: (i: number) => void }) {
  const visible = photos.slice(0, 4)
  const hiddenCount = photos.length - visible.length
  return (
    <div className="mt-3">
      <button
        onClick={() => onOpen(0)}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 mb-2"
      >
        <Images className="h-3.5 w-3.5" />
        Xem ảnh ({photos.length})
      </button>
      <div className="grid grid-cols-4 gap-1.5 max-w-70">
        {visible.map((src, i) => (
          <button
            key={i}
            onClick={() => onOpen(i)}
            className="relative aspect-square rounded-md overflow-hidden ring-1 ring-black/5 hover:ring-2 hover:ring-blue-400 transition-all group"
          >
            <img src={src} alt={`Ảnh ${i + 1}`} className="w-full h-full object-cover transition-transform" loading="lazy" decoding="async" />
            {i === 3 && hiddenCount > 0 && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-xs font-bold">
                +{hiddenCount}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
