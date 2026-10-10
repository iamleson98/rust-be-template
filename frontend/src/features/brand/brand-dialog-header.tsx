'use client'

import { DialogTitle, DialogDescription } from '@/components/ui/dialog'
import type { BrandDetailOut, RouteOut } from '@/api'
import { Stars } from '@/features/reviews/review-summary'
import { useT } from '@/lib/i18n'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/** One figure of the brand's stats strip. */
function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2">
      <div className="text-lg leading-tight font-semibold tabular-nums">
        {value.toLocaleString('vi-VN')}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

/** The brand's identity, rating and what it runs. */
export function BrandDialogHeader({
  brand,
  accent,
  reviewCount,
  routes,
}: {
  brand: BrandDetailOut
  accent: string
  reviewCount: number
  routes: RouteOut[]
}) {
  const t = useT()
  // Each schedule departs once a day.
  const departures = routes.reduce((sum, r) => sum + r.scheduleCount, 0)

  return (
    <div className="shrink-0 space-y-3 border-b px-4 pt-4 pb-3 sm:px-5">
      {/* pr-10 keeps the name clear of the dialog's close button. */}
      <div className="flex items-start gap-3 pr-10">
        <div
          className="grid size-14 shrink-0 place-items-center rounded-xl text-lg font-bold text-white"
          style={{ background: accent }}
        >
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt=""
              className="size-10 object-contain"
              loading="lazy"
              decoding="async"
            />
          ) : (
            initials(brand.name)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-lg leading-snug font-bold">{brand.name}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('brandDetail.dialogDescription', { brand: brand.name })}
          </DialogDescription>
          {brand.rating != null ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
              <Stars rating={brand.rating} />
              <span className="font-semibold text-amber-600">{brand.rating.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">
                ({t('reviews.countLabel', { count: reviewCount })})
              </span>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{t('brandDetail.noReviewsYet')}</p>
          )}
        </div>
      </div>

      {brand.description && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{brand.description}</p>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Figure value={routes.length} label={t('admin.routes')} />
        <Figure value={departures} label={t('brandDetail.tripsPerDay')} />
        <Figure value={reviewCount} label={t('brandDetail.reviewCountLabel')} />
      </div>
    </div>
  )
}
