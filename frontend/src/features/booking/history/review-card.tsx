'use client'

// Extracted from the original 'booking-stats.tsx'.

import { memo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bus, ArrowRightLeft, Clock, Star, Quote } from 'lucide-react'
import { formatDateVN, formatDateTimeVN } from '@/lib/types'
import { ReviewItem, REVIEW_TAG_LABELS } from '@/features/booking/history/booking-types'

/* ───────────────────────────────────────────────────────────────────────
 * ReviewCard — single review written by the logged-in user. Display-only.
 * ─────────────────────────────────────────────────────────────────────── */
export const ReviewCard = memo(function ReviewCard({ r }: { r: ReviewItem }) {
  const accent = r.brand?.accentColor || '#2563eb'
  return (
    <Card className="overflow-hidden ring-1 ring-black/5 transition-all duration-300">
      <div className="relative flex">
        <div
          className="hidden md:block w-1.5 shrink-0 self-stretch"
          style={{ background: accent }}
        />
        <div className="flex-1">
          <div
            className="h-1.5"
            style={{
              background: `linear-gradient(90deg, ${accent}, ${accent}44, transparent)`,
            }}
          />
          <CardContent className="p-4 md:p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0 text-white"
                  style={{ background: accent }}
                >
                  <Bus className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                    <span className="truncate">{r.route?.fromName || '—'}</span>
                    <ArrowRightLeft className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span className="truncate">{r.route?.toName || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                      style={{ background: accent }}
                    >
                      <Bus className="h-2.5 w-2.5" />
                      {r.brand?.name || 'Nhà xe'}
                    </span>
                    <span className="text-muted-foreground/60">•</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDateVN(r.createdAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={`h-4 w-4 ${s <= r.rating
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-slate-100 text-slate-200'
                      }`}
                  />
                ))}
                <span className="ml-1.5 text-xs font-bold text-amber-600">{r.rating}.0</span>
              </div>
            </div>

            {(r.title || r.content) && (
              <div className="space-y-1.5">
                {r.title && (
                  <div className="flex items-start gap-2">
                    <Quote className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <h4 className="font-bold text-sm md:text-base text-foreground leading-snug">
                      {r.title}
                    </h4>
                  </div>
                )}
                {r.content && (
                  <p className="text-sm text-muted-foreground leading-relaxed pl-6 whitespace-pre-line">
                    {r.content}
                  </p>
                )}
              </div>
            )}

            {r.tags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                {r.tags.map((t, i) => {
                  const meta = REVIEW_TAG_LABELS[t]
                  return (
                    <Badge
                      key={`${t}-${i}`}
                      variant="outline"
                      className="text-[11px] gap-1 px-2 py-0.5 bg-amber-50/60 border-amber-200/60 text-amber-800 font-medium"
                    >
                      {meta ? (
                        <>
                          <span>{meta.emoji}</span>
                          {meta.label}
                        </>
                      ) : (
                        t.replace(/_/g, ' ')
                      )}
                    </Badge>
                  )
                })}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-dashed border-slate-200">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 inline-flex items-center justify-center text-[11px] font-bold">
                  {(r.authorName || '?').slice(0, 1).toUpperCase()}
                </div>
                <span className="font-medium text-foreground/80">{r.authorName}</span>
              </div>
              <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDateTimeVN(r.createdAt)}
              </div>
            </div>
          </CardContent>
        </div>
      </div>
    </Card>
  )
})
