'use client'

// Extracted from the original 'brand-detail-dialog.tsx'.

import {
  Star,
  Sparkles,
  Clock,
  Smile,
  Armchair,
  ShieldCheck,
  Wallet,
  Wifi,
  Snowflake,
  Ticket as TicketIcon,
  type LucideIcon,
} from 'lucide-react'
import type { TagStat } from './brand-detail-helpers'

// Tag icon mapping — aligned to actual DB tag keys.
const TAG_ICONS: Record<string, LucideIcon> = {
  on_time: Clock,
  clean: Sparkles,
  friendly_driver: Smile,
  comfortable: Armchair,
  safe_drive: ShieldCheck,
  value: Wallet,
  good_wifi: Wifi,
  ac: Snowflake,
  easy_booking: TicketIcon,
}

// ── Tag aggregate stats section (brand-wide, shown in reviews tab) ──
export function BrandTagStats({ tagStats, accentColor }: { tagStats: TagStat[]; accentColor: string }) {
  return (
    <div className="rounded-xl bg-linear-to-br from-blue-50 to-blue-50 ring-1 ring-blue-200/50 p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <h4 className="text-sm font-semibold text-blue-800">Đặc điểm được khen nhiều</h4>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Top {tagStats.length} nổi bật nhất
        </span>
      </div>
      <div className="space-y-2.5">
        {tagStats.map((t) => {
          const Icon = TAG_ICONS[t.tag] ?? Star
          return (
            <div key={t.tag} className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 w-40 sm:w-48 shrink-0">
                <div
                  className="h-7 w-7 rounded-md flex items-center justify-center text-white shrink-0"
                  style={{ background: accentColor }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate text-slate-700">{t.label}</div>
                  <div className="text-[10px] text-muted-foreground">{t.count} lượt nhắc</div>
                </div>
              </div>
              <div className="flex-1 h-2.5 bg-white/70 rounded-full overflow-hidden ring-1 ring-blue-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${accentColor}, ${accentColor}cc)`,
                  }}
                />
              </div>
              <span
                className="text-xs font-bold tabular-nums w-10 text-right"
                style={{ color: accentColor }}
              >
                {t.percentage}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
