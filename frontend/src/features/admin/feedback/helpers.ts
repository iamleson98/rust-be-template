/**
 * Shared types + pure helpers for the admin feedback feature.
 *
 * Extracted from the original 'src/features/admin/feedback/feedback-panel.tsx'.
 */

import { usePrefs } from '@/stores/prefs'
import { format, isValid, parseISO } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'
import type { ReviewOut } from '@/api'

/** One row of the admin feedback table — a customer review. */
export type FeedbackRow = ReviewOut

export function formatDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    const d = parseISO(s)
    if (!isValid(d)) return s
    const loc = usePrefs.getState().lang === 'en' ? enUS : vi
    return format(d, 'dd/MM/yyyy HH:mm', { locale: loc })
  } catch {
    return s ?? '—'
  }
}
