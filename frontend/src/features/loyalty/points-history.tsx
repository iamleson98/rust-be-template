'use client'

// Extracted from the original 'loyalty-widget.tsx'.
//
// REAL-DATA REWORK: the history is the backend's per-booking earning
// ledger (completed bookings, newest first) — the old MOCK_HISTORY is
// gone. Each row shows the booking code, route, date and the points
// that booking earned.

import { usePrefs } from '@/stores/prefs'
import { History, Bus, Plus } from 'lucide-react'
import { useT } from '@/lib/i18n'
import type { LoyaltyHistoryEntry } from '@/api'

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const lang = usePrefs.getState().lang
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function LoyaltyPointsHistory({ history }: { history: LoyaltyHistoryEntry[] }) {
  const t = useT()
  const lang = usePrefs((s) => s.lang)
  const locale = lang === 'en' ? 'en-US' : 'vi-VN'

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-sm">
        <History className="h-4 w-4 text-slate-500" />
        {t('home.pointsHistory')}
      </h3>
      {history.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">
          {t('home.historyEmpty')}
        </p>
      ) : (
        <div className="space-y-1.5">
          {history.map((h) => {
            const date = formatDate(h.departureAt)
            return (
              <div
                key={h.bookingId}
                className="flex items-center justify-between border-b border-dashed border-slate-200 py-1.5 text-xs last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <Bus className="size-3 shrink-0 text-blue-500" aria-hidden />
                    <span className="truncate">{h.routeName ?? h.bookingCode}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {date ? `${date} · ` : ''}
                    <code className="font-mono">{h.bookingCode}</code>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-0.5 font-bold text-blue-600">
                  <Plus className="size-3" aria-hidden />
                  {h.points.toLocaleString(locale)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
