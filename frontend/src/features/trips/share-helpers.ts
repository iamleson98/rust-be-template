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
 * Generate a deterministic shareable code + URL from a trip id.
 * Not a real URL — just for the demo copy-to-clipboard action.
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
  return { code, url: `https://datxevui.vn/s/${code}` }
}
