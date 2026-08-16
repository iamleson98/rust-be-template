/**
 * Shared types for the AdminDashboard module.
 *
 * Extracted verbatim from the original `admin-dashboard.tsx`
 * (lines 71-141 + 165-176 + 318). Pure refactor.
 */

export type Stats = {
  brands: number
  routes: number
  trips: number
  places: number
  campaigns: number
  bookings: number
  revenue: number
  happyCustomers: number
}

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

export type RecentBooking = {
  code: string
  name: string
  phone: string
  route: string
  departDate: string
  seat: string
  price: number
  status: 'confirmed' | 'pending' | 'cancelled' | 'refunded'
  payment: string
  time: string
}

export type DateRange = '7d' | '30d' | '90d'
