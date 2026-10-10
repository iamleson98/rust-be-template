import { formatDay, formatNum, useMoney } from '@/lib/format'
import type { LoyaltyHistoryEntry } from '@/api'

/** Points earned per completed booking, newest first (the backend's ledger). */
export function LoyaltyPointsHistory({ history }: { history: LoyaltyHistoryEntry[] }) {
  const money = useMoney()
  return (
    <ul className="divide-y divide-slate-100">
      {history.map((h) => (
        <li key={h.bookingId} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">
              {h.routeName ?? h.bookingCode}
            </div>
            <div className="truncate text-xs text-slate-500">
              {[h.departureAt && formatDay(h.departureAt), h.bookingCode, money(h.total)]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <span className="shrink-0 text-sm font-semibold text-emerald-600 tabular-nums">
            +{formatNum(h.points)}
          </span>
        </li>
      ))}
    </ul>
  )
}
