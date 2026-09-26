/**
 * Shared types + pure helpers for the admin feedback feature.
 *
 * Extracted from the original 'src/features/admin/feedback/feedback-panel.tsx'.
 */

import { format, isValid, parseISO } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'
import { useApp } from '@/lib/store'
import type { ReviewOut } from '@/lib/api/types.gen'

/** One row of the admin feedback table — a customer review. */
export type FeedbackRow = ReviewOut

export function formatDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    const d = parseISO(s)
    if (!isValid(d)) return s
    const loc = useApp.getState().lang === 'en' ? enUS : vi
    return format(d, 'dd/MM/yyyy HH:mm', { locale: loc })
  } catch {
    return s ?? '—'
  }
}
