/**
 * Shared helpers + types for the ShareDialog module.
 *
 * Extracted from the original `share-dialog.tsx` so the dialog, the
 * canvas image exporter and the email form can share the same
 * shareable-code generator + trip payload type.
 */

import type { useApp } from '@/lib/store'

/** The trip payload the store carries for the share dialog (`shareTripData`). */
export type ShareTripData = NonNullable<ReturnType<typeof useApp.getState>['shareTripData']>

/**
 * Build the share link for a trip.
 *
 * The URL is the REAL deep link (`/trips/$tripId` — the registered,
 * deep-linkable route). The previous implementation fabricated
 * `https://datxevui.com/s/{code}`, a path that exists nowhere: every
 * copied link, social share and email pointed at a 404.
 *
 * `code` is kept as a short display-only reference derived from the trip
 * id (rendered on the share card / image, never used as a URL).
 */
export function buildShareUrl(tripId: string): { code: string; url: string } {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let hash = 0
  for (let i = 0; i < tripId.length; i++) {
    hash = ((hash << 5) - hash + tripId.charCodeAt(i)) | 0
  }
  const seed = Math.abs(hash)
  let code = 'PT-'
  for (let i = 0; i < 6; i++) {
    code += chars[(seed + i * 31) % chars.length]
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://datxevui.com'
  return { code, url: `${origin}/trips/${encodeURIComponent(tripId)}` }
}
