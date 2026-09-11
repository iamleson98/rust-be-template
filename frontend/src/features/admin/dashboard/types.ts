/**
 * Shared types for the AdminDashboard module.
 *
 * Most types now come from `@/lib/api/types.gen` (re-exported via
 * `@/lib/queries`). Only the types that aren't generated — local UI
 * shapes used by the chat workspace, the date-range picker, and the
 * reviews moderation panel — are kept here.
 */

import type {
  AdminBookingStatsResponse,
  StatsResponse,
} from '@/lib/api/types.gen'

// Re-export the generated stats response shape under the short name the
// dashboard components expect. This keeps the public-facing `/api/stats`
// payload (brands/routes/trips counts) and the admin booking stats
// payload (totals/byDay) reachable through a single import.
export type { StatsResponse as Stats, AdminBookingStatsResponse as AdminBookingStats }

export type AdminChannel = {
  id: string
  topic: string
  status: string
  priority: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadEmployee: number
  brand?: { name: string | null; accentColor: string | null } | null
  /** The customer who started the channel. Populated by the backend
   *  (joined from `user` table by `user_id`) — `email` + `avatarUrl`
   *  are present when the backend ships the new `ChatChannelOut.user`
   *  field (older API responses may omit them, hence optional). */
  user?: {
    id?: string
    fullName?: string | null
    email?: string | null
    phone?: string | null
    avatarUrl?: string | null
  } | null
  assignments?: { employee: { id: string; name: string } }[]
  /** The staff member currently assigned (three-role routing). Present
   *  when the channel has an active `chat_assignment` row; admins own
   *  every channel implicitly and never appear here. */
  assignedTo?: {
    id: string
    fullName?: string | null
    email?: string | null
    avatarUrl?: string | null
  } | null
  /** True when the requester IS the assignee (employee workspace). */
  assignedToMe?: boolean
}

export type AdminCampaignRow = {
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

export type AdminChatMessage = {
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

export type DateRange = '7d' | '30d' | '90d'
