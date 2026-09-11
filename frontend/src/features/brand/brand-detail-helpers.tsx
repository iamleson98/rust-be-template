'use client'

// Extracted from the original 'brand-detail-dialog.tsx'.

import { Star } from 'lucide-react'

// Extended Brand type — the centralized `Brand` type doesn't include the
// contact fields the `/api/brands/:slug` endpoint returns, so we extend it
// locally rather than mutating the shared type definition.
export type BrandDetail = {
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

export type TagStat = {
  tag: string
  label: string
  emoji: string
  count: number
  percentage: number
}

export type Review = {
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

export function renderStars(rating: number, size = 'h-3.5 w-3.5') {
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
