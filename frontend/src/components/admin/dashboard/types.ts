/**
 * Shared types for the AdminDashboard module.
 *
 * Most types now come from `@/lib/api/types.gen` (re-exported via
 * `@/lib/queries`). Only the types that aren't generated — local UI
 * shapes used by the chat workspace, the date-range picker, and the
 * reviews moderation panel — are kept here.
 */

import type {
  AdminBookingOut,
  AdminBookingStatsResponse,
  StatsResponse,
} from '@/lib/api/types.gen'

// Re-export the generated stats response shape under the short name the
// dashboard components expect. This keeps the public-facing `/api/stats`
// payload (brands/routes/trips counts) and the admin booking stats
// payload (totals/byDay) reachable through a single import.
export type { StatsResponse as Stats, AdminBookingStatsResponse as AdminBookingStats }

export type Channel = {
  id: string
  topic: string
  status: string
  priority: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadEmployee: number
  brand?: { name: string | null; accentColor: string | null } | null
  user?: { fullName: string | null; phone: string | null } | null
  assignments?: { employee: { id: string; name: string } }[]
}

export type Campaign = {
  id: string
  code: string
  name: string
  type: string
  value: number
  usedCount: number
  usageLimitTotal: number
  status: string
  brand?: { name: string | null } | null
}

export type ChatMessage = {
  id: string
  content: string
  senderType: string
  senderName: string | null
  createdAt: string
  /** Message kind: `text` (default) | `ticket` (booking card) | `image` | `system`. */
  kind?: string
  /** JSON-encoded attachments (e.g. booking card payload for `kind: 'ticket'`). */
  attachments?: string | null
}

export type AdminReview = {
  id: string
  rating: number
  title: string
  content: string
  tags: string[]
  authorName: string
  authorPhone: string | null
  status: string
  helpfulCount: number
  reply: string | null
  repliedAt: string | null
  createdAt: string
  updatedAt: string
  brand: { id: string; name: string; accentColor: string } | null
  route: { id: string; name: string; slug: string } | null
}

export type AdminReviewStats = {
  total: number
  pending: number
  published: number
  hidden: number
  flagged: number
  avgRating: number
  responseRate: number
}

export type DateRange = '7d' | '30d' | '90d'

// Re-export `AdminBookingOut` so the dashboard's recent-bookings row type
// stays in sync with the generated SDK shape (no hand-rolled duplicate).
export type { AdminBookingOut as RecentBooking }
