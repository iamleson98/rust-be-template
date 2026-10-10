import type { AdminBookingStatsResponse, StatsResponse } from '@/api'

// Re-export the generated stats response shape under the short name the
// dashboard components expect. This keeps the public-facing `/api/stats`
// payload (brands/routes/trips counts) and the admin booking stats
// payload (totals/byDay) reachable through a single import.
export type { StatsResponse as Stats, AdminBookingStatsResponse as AdminBookingStats }

export type DateRange = '7d' | '30d' | '90d'
