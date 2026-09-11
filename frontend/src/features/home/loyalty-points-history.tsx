'use client'

// Extracted from the original 'loyalty-widget.tsx'.

import { History } from 'lucide-react'
import { MOCK_HISTORY } from './loyalty-data'

export function LoyaltyPointsHistory() {
  return (
    <div>
      <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
        <History className="h-4 w-4 text-slate-500" />
        Lịch sử điểm
      </h3>
      <div className="space-y-1.5">
        {MOCK_HISTORY.map((h) => (
          <div key={h.id} className="flex items-center justify-between text-xs py-1.5 border-b border-dashed border-slate-200 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="text-slate-700 truncate">{h.description}</div>
              <div className="text-[10px] text-muted-foreground">{h.date}</div>
            </div>
            <span className={`font-bold ${h.amount > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
              {h.amount > 0 ? '+' : ''}{h.amount} điểm
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
